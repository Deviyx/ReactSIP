import { useState, useEffect, useCallback, useRef } from 'react';
import JsSIP from 'jssip';
import { useSIPContext } from '../context/SIPContext';
import toast from 'react-hot-toast';

const isElectron = window.electronAPI !== undefined;
let listenersBound = false;
const callStateSeen = new Map();
const callHistoryLogged = new Set();
const terminalStateNotified = new Set();

let webUA = null;
const webSessions = new Map();
let remoteAudioEl = null;

const isUdpMode = (settings) => !settings.transport || settings.transport.toLowerCase() === 'udp';

const getWebCallId = (session) => {
  const callId = session?.request?.call_id || session?._request?.call_id || session?._id;
  if (callId) return `web_${callId}`;
  return `web_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
};

const getWsUrl = (settings) => {
  const hostValue = (settings.ws_servers_host || '').trim();
  const portValue = (settings.ws_servers_port || '').trim();
  const transport = (settings.transport || 'wss').toLowerCase();

  if (!hostValue) return '';

  if (/^wss?:\/\//i.test(hostValue)) {
    return hostValue;
  }

  if (hostValue.includes('/')) {
    return `${transport}://${hostValue}`;
  }

  const port = portValue ? `:${portValue}` : '';
  return `${transport}://${hostValue}${port}/ws`;
};

const ensureRemoteAudio = async (settings) => {
  if (!remoteAudioEl) {
    remoteAudioEl = document.createElement('audio');
    remoteAudioEl.autoplay = true;
    remoteAudioEl.playsInline = true;
    remoteAudioEl.style.display = 'none';
    document.body.appendChild(remoteAudioEl);
    window.__reactsipRemoteAudioEl = remoteAudioEl;
  }

  const outputVolume = Number(settings.audio_output_volume ?? 100) / 100;
  remoteAudioEl.volume = Math.max(0, Math.min(1.5, outputVolume));

  const sinkId = settings.audio_output_device_id || 'default';
  if (typeof remoteAudioEl.setSinkId === 'function') {
    try {
      await remoteAudioEl.setSinkId(sinkId);
    } catch (error) {
      console.warn('Unable to set output device:', error);
    }
  }

  return remoteAudioEl;
};

const findActiveCall = (calls) => [...calls].reverse().find((call) => call && !['ended', 'failed'].includes(call.status));
const sanitizeText = (value) => String(value || '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();
const findCallForEvent = (calls, eventId) => {
  const byId = calls.find((call) => call?.id === eventId);
  if (byId) return byId;

  const candidates = [...calls].reverse().filter((call) => call && !['ended', 'failed'].includes(call.status));
  if (candidates.length === 1) return candidates[0];

  const outgoing = candidates.find((call) => call.direction === 'outgoing');
  return outgoing || null;
};

const resolveCallNumber = (session, fallback = '') => {
  const candidates = [
    fallback,
    session?.remote_identity?.uri?.user,
    session?.remote_identity?.display_name,
  ];
  const value = candidates
    .map((item) => sanitizeText(item))
    .find((item) => item && item.toLowerCase() !== 'unknown');
  return value || 'Unknown number';
};

const TERMINAL_STATES = ['failed', 'ended', 'cancelled', 'rejected', 'terminated', 'busy', 'no_answer'];

export const useSIP = () => {
  const {
    settings,
    calls,
    incomingCallData,
    setConnectionStatus,
    setSipUri,
    setSession,
    addCall,
    updateCall,
    setRegistrationStatus,
    setIncomingCallData,
    addToHistory,
    setMuted,
    setOnHold,
  } = useSIPContext();

  const [isMuted, setIsMutedLocal] = useState(false);
  const [isOnHold, setIsOnHoldLocal] = useState(false);
  const callsRef = useRef(calls);
  const incomingCallRef = useRef(incomingCallData);
  const toneContextRef = useRef(null);
  const ringbackTimerRef = useRef(null);
  const ringbackStartedRef = useRef(false);

  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);

  useEffect(() => {
    incomingCallRef.current = incomingCallData;
  }, [incomingCallData]);

  useEffect(() => () => {
    stopRingback();
    if (toneContextRef.current) {
      toneContextRef.current.close().catch(() => {});
      toneContextRef.current = null;
    }
  }, [stopRingback]);

  const ensureToneContext = useCallback(async () => {
    if (toneContextRef.current) return toneContextRef.current;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    toneContextRef.current = ctx;
    await ctx.resume().catch(() => {});
    return ctx;
  }, []);

  const stopRingback = useCallback(() => {
    if (ringbackTimerRef.current) {
      clearInterval(ringbackTimerRef.current);
      ringbackTimerRef.current = null;
    }
    ringbackStartedRef.current = false;
  }, []);

  const startRingback = useCallback(async () => {
    if (ringbackStartedRef.current) return;
    const ctx = await ensureToneContext();
    if (!ctx) return;

    const playBurst = () => {
      const now = ctx.currentTime;
      [440, 480].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(0.045, now + (idx === 0 ? 0.02 : 0.24));
        gain.gain.exponentialRampToValueAtTime(0.0001, now + (idx === 0 ? 0.2 : 0.42));
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + (idx === 0 ? 0 : 0.22));
        osc.stop(now + (idx === 0 ? 0.22 : 0.45));
      });
    };

    playBurst();
    ringbackTimerRef.current = setInterval(playBurst, 1800);
    ringbackStartedRef.current = true;
  }, [ensureToneContext]);

  const playHangupTone = useCallback(async () => {
    const ctx = await ensureToneContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.22);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.05, now + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.28);
  }, [ensureToneContext]);

  const attachSessionEvents = useCallback((session, callId, direction) => {
    if (!session || session.__appBound) return;
    session.__appBound = true;

    session.on('peerconnection', async (e) => {
      const pc = e.peerconnection;
      if (!pc) return;

      pc.addEventListener('track', async (event) => {
        if (!event.streams || !event.streams.length) return;
        const audio = await ensureRemoteAudio(settings);
        audio.srcObject = event.streams[0];
        audio.play().catch(() => {});
      });
    });

    session.on('progress', () => {
      updateCall(callId, { status: 'ringing' });
      if (direction === 'outgoing') startRingback().catch(() => {});
    });

    session.on('accepted', () => {
      updateCall(callId, { status: 'ringing' });
      if (direction === 'outgoing') startRingback().catch(() => {});
    });

    session.on('confirmed', () => {
      updateCall(callId, { status: 'connected' });
      stopRingback();
      setSession(session);
      toast.success('Call connected', { id: `call-state-${callId}` });
    });

    const finishCall = (state, reason) => {
      updateCall(callId, { status: state });
      webSessions.delete(callId);
      stopRingback();
      setSession(null);
      setIncomingCallData(null);

      addToHistory({
        id: callId,
        number: resolveCallNumber(session),
        displayName: resolveCallNumber(session),
        direction,
        status: state === 'ended' ? 'completed' : 'failed',
        duration: 0,
        timestamp: new Date(),
      });

      if (state === 'failed') {
        const statusCode = reason?.message?.status_code || reason?.cause || '';
        if (String(statusCode) === '404') {
          toast.error('Number does not exist', { id: `call-state-${callId}` });
        } else {
          toast.error(`Call failed ${statusCode ? `(${statusCode})` : ''}`, { id: `call-state-${callId}` });
        }
      } else {
        toast('Call ended', { id: `call-state-${callId}` });
      }
      playHangupTone().catch(() => {});
    };

    session.on('ended', (e) => finishCall('ended', e));
    session.on('failed', (e) => finishCall('failed', e));
  }, [addToHistory, playHangupTone, setIncomingCallData, setSession, settings, startRingback, stopRingback, updateCall]);

  const connectWebRTC = useCallback(async () => {
    if (!settings.username || !settings.password || !settings.domain) {
      toast.error('Please fill username, password, and domain');
      return;
    }

    const wsUrl = getWsUrl(settings);
    if (!wsUrl) {
      toast.error('Configure SIP WebSocket host/port in Settings');
      return;
    }

    setConnectionStatus('Connecting');
    setRegistrationStatus('Registering');

    try {
      const socket = new JsSIP.WebSocketInterface(wsUrl);
      webUA = new JsSIP.UA({
        sockets: [socket],
        uri: `sip:${settings.username}@${settings.domain}`,
        password: settings.password,
        display_name: settings.display_name || settings.username,
        register: true,
        session_timers: false,
      });

      webUA.on('connected', () => {
        setConnectionStatus('Connected');
      });

      webUA.on('disconnected', () => {
        setConnectionStatus('Disconnected');
      });

      webUA.on('registered', () => {
        setRegistrationStatus('Registered');
        setSipUri(`sip:${settings.username}@${settings.domain}`);
        toast.success(`Registered via WebRTC: sip:${settings.username}@${settings.domain}`);
      });

      webUA.on('registrationFailed', (e) => {
        setRegistrationStatus('Registration Failed');
        setConnectionStatus('Disconnected');
        const reason = e?.cause || 'falha de registro';
        toast.error(`WebRTC registration failed: ${reason}`);
      });

      webUA.on('newRTCSession', async ({ session, originator }) => {
        const callId = getWebCallId(session);
        const number = session?.remote_identity?.uri?.user || 'unknown';
        const displayName = session?.remote_identity?.display_name || number;

        webSessions.set(callId, session);
        attachSessionEvents(session, callId, originator === 'remote' ? 'incoming' : 'outgoing');

        if (originator === 'remote') {
          setIncomingCallData({ id: callId, number, displayName });
          addCall({
            id: callId,
            number,
            displayName,
            direction: 'incoming',
            status: 'ringing',
            startTime: new Date(),
          });
          toast.info(`Incoming call from ${displayName}`);
        } else {
          updateCall(callId, { id: callId });
        }

        await ensureRemoteAudio(settings);
      });

      webUA.start();
    } catch (error) {
      setConnectionStatus('Disconnected');
      setRegistrationStatus('Registration Failed');
      toast.error(`WebRTC error: ${error.message}`);
    }
  }, [addCall, attachSessionEvents, setConnectionStatus, setIncomingCallData, setRegistrationStatus, setSipUri, settings, updateCall]);

  const connect = useCallback(async () => {
    if (isUdpMode(settings)) {
      if (!isElectron) {
        toast.error('UDP mode requires Electron');
        return;
      }

      try {
        setConnectionStatus('Connecting');
        const result = await window.electronAPI.sip.connect({
          username: settings.username,
          password: settings.password,
          domain: settings.domain,
          display_name: settings.display_name || settings.username,
          transport: settings.transport || 'udp',
          local_sip_port: settings.local_sip_port || 5061,
          rtp_port_start: settings.rtp_port_start || 4000,
          rtp_port_end: settings.rtp_port_end || 4999,
          stun_server: settings.stun_server || '',
        });

        if (result.success) {
          if (result.engine === 'native') {
            setConnectionStatus('Connecting');
            setRegistrationStatus('Registering');
            setSipUri(`sip:${settings.username}@${settings.domain}`);
            toast('Connecting via native UDP engine...');
          } else {
            setConnectionStatus('Connected');
            setRegistrationStatus('Registered');
            setSipUri(`sip:${settings.username}@${settings.domain}`);
            toast.success(`Registered as sip:${settings.username}@${settings.domain}`);
          }
        } else {
          setConnectionStatus('Disconnected');
          setRegistrationStatus('Registration Failed');
          toast.error(`Connection failed: ${result.error}`);
        }
      } catch (error) {
        setConnectionStatus('Disconnected');
        setRegistrationStatus('Registration Failed');
        toast.error(`Connection error: ${error.message}`);
      }
      return;
    }

    await connectWebRTC();
  }, [connectWebRTC, setConnectionStatus, setRegistrationStatus, setSipUri, settings]);

  const disconnect = useCallback(async () => {
    if (isUdpMode(settings)) {
      try {
        await window.electronAPI.sip.disconnect();
      } catch (error) {
        console.error('Disconnect error:', error);
      }
      stopRingback();
      setConnectionStatus('Disconnected');
      setRegistrationStatus('Unregistered');
      setSipUri(null);
      toast.success('Disconnected');
      return;
    }

    webSessions.forEach((session) => {
      try {
        session.terminate();
      } catch {
        // noop
      }
    });
    webSessions.clear();
    stopRingback();
    if (webUA) {
      try {
        webUA.stop();
      } catch {
        // noop
      }
      webUA = null;
    }
    setConnectionStatus('Disconnected');
    setRegistrationStatus('Unregistered');
    setSipUri(null);
    setSession(null);
    setIncomingCallData(null);
    toast.success('Disconnected');
  }, [setConnectionStatus, setIncomingCallData, setRegistrationStatus, setSession, setSipUri, settings, stopRingback]);

  const makeCall = useCallback(async (number) => {
    if (!number) {
      toast.error('Please enter a number');
      return;
    }

    if (isUdpMode(settings)) {
      try {
        const result = await window.electronAPI.sip.call(number);
        if (result.success) {
          terminalStateNotified.delete(result.callId);
          callHistoryLogged.delete(result.callId);
          callStateSeen.delete(result.callId);
          addCall({
            id: result.callId,
            number,
            displayName: number,
            direction: 'outgoing',
            status: 'calling',
            startTime: new Date(),
          });
          startRingback().catch(() => {});
          toast(`Calling ${number}...`);
        } else {
          toast.error(`Call failed: ${result.error}`);
        }
      } catch (error) {
        toast.error(`Call error: ${error.message}`);
      }
      return;
    }

    if (!webUA) {
      toast.error('Conecte primeiro em modo WebRTC');
      return;
    }

    const target = /^sip:/i.test(number) ? number : `sip:${number}@${settings.domain}`;
    try {
      const session = webUA.call(target, {
        mediaConstraints: { audio: true, video: false },
        pcConfig: {
          rtcpMuxPolicy: 'require',
          iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
        },
      });
      const callId = getWebCallId(session);
      webSessions.set(callId, session);
      terminalStateNotified.delete(callId);
      callHistoryLogged.delete(callId);
      callStateSeen.delete(callId);
      attachSessionEvents(session, callId, 'outgoing');

      addCall({
        id: callId,
        number,
        displayName: number,
        direction: 'outgoing',
        status: 'calling',
        startTime: new Date(),
      });
      setSession(session);
      startRingback().catch(() => {});
      toast(`Calling ${number}...`);
    } catch (error) {
      toast.error(`Failed to call: ${error.message}`);
    }
  }, [addCall, attachSessionEvents, setSession, settings, startRingback]);

  const answerCall = useCallback(async (callId) => {
    if (isUdpMode(settings)) {
      try {
        const result = await window.electronAPI.sip.accept(callId);
        if (result.success) {
          stopRingback();
          toast.success('Call accepted');
        } else {
          const errText = String(result.error || '').toLowerCase();
          if (errText.includes('not found')) {
            setIncomingCallData(null);
            updateCall(callId, { status: 'failed' });
            toast.error('This call has already ended');
            return;
          }
          toast.error(`Accept failed: ${result.error}`);
        }
      } catch (error) {
        const errText = String(error?.message || '').toLowerCase();
        if (errText.includes('not found')) {
          setIncomingCallData(null);
          updateCall(callId, { status: 'failed' });
          toast.error('This call has already ended');
          return;
        }
        toast.error(`Accept error: ${error.message}`);
      }
      return;
    }

    const session = webSessions.get(callId);
    if (!session) {
      toast.error('Call not found');
      return;
    }
    try {
      session.answer({ mediaConstraints: { audio: true, video: false } });
      stopRingback();
      setIncomingCallData(null);
      toast.success('Call answered');
    } catch (error) {
      toast.error(`Error answering call: ${error.message}`);
    }
  }, [setIncomingCallData, settings, stopRingback, updateCall]);

  const hangupCall = useCallback(async (callId) => {
    stopRingback();
    if (isUdpMode(settings)) {
      try {
        const result = await window.electronAPI.sip.hangup(callId);
        if (result.success) toast.success('Call ended');
        else toast.error(`Hangup failed: ${result.error}`);
      } catch (error) {
        toast.error(`Hangup error: ${error.message}`);
      }
      return;
    }

    const session = webSessions.get(callId);
    if (!session) return;
    try {
      session.terminate();
    } catch (error) {
      toast.error(`Error hanging up: ${error.message}`);
    }
  }, [settings, stopRingback]);

  const transferCall = useCallback(async (callId, target) => {
    if (!target) return;
    if (isUdpMode(settings)) {
      try {
        const result = await window.electronAPI.sip.transfer(callId, target);
        if (!result.success) toast.error(`Transfer failed: ${result.error}`);
      } catch (error) {
        toast.error(`Transfer error: ${error.message}`);
      }
      return;
    }

    const session = webSessions.get(callId);
    if (!session) return;
    const referTarget = /^sip:/i.test(target) ? target : `sip:${target}@${settings.domain}`;
    try {
      session.refer(referTarget);
      toast.success('Transfer sent');
    } catch (error) {
      toast.error(`Transfer failed: ${error.message}`);
    }
  }, [settings]);

  const rejectCall = useCallback(async (callId) => {
    stopRingback();
    if (isUdpMode(settings)) {
      try {
        await window.electronAPI.sip.reject(callId);
      } catch (error) {
        console.error('Reject error:', error);
      }
      updateCall(callId, { status: 'ended' });
      setIncomingCallData(null);
      toast.info('Call rejected');
      return;
    }

    const session = webSessions.get(callId);
    if (!session) return;
    try {
      session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      setIncomingCallData(null);
      toast('Call rejected');
    } catch (error) {
      toast.error(`Error rejecting call: ${error.message}`);
    }
  }, [setIncomingCallData, settings, stopRingback, updateCall]);

  const muteCall = useCallback(async () => {
    const activeCall = findActiveCall(calls);
    if (!activeCall) return;

    if (isUdpMode(settings)) {
      const next = !isMuted;
      try {
        const result = await window.electronAPI.sip.mute(activeCall.id, next);
        if (!result?.success) throw new Error(result?.error || 'Failed to mute');
        setIsMutedLocal(next);
        setMuted(next);
        toast.success(next ? 'Microphone muted' : 'Microphone unmuted', { id: `mute-${activeCall.id}` });
      } catch (error) {
        toast.error(`Failed to change mute: ${error.message}`);
      }
      return;
    }

    const session = webSessions.get(activeCall.id);
    if (!session) return;
    setIsMutedLocal((prev) => {
      const next = !prev;
      if (next) session.mute({ audio: true });
      else session.unmute({ audio: true });
      setMuted(next);
      return next;
    });
  }, [calls, isMuted, setMuted, settings]);

  const holdCall = useCallback(async () => {
    const activeCall = findActiveCall(calls);
    if (!activeCall) return;

    if (isUdpMode(settings)) {
      const next = !isOnHold;
      try {
        const result = await window.electronAPI.sip.hold(activeCall.id, next);
        if (!result?.success) throw new Error(result?.error || 'Failed to put call on hold');
        setIsOnHoldLocal(next);
        setOnHold(next);
        updateCall(activeCall.id, { status: next ? 'holding' : 'connected' });
        toast.success(next ? 'Call on hold' : 'Call resumed', { id: `hold-${activeCall.id}` });
      } catch (error) {
        toast.error(`Hold failed: ${error.message}`);
      }
      return;
    }

    const session = webSessions.get(activeCall.id);
    if (!session) return;
    setIsOnHoldLocal((prev) => {
      const next = !prev;
      if (next) session.hold();
      else session.unhold();
      setOnHold(next);
      return next;
    });
  }, [calls, isOnHold, setOnHold, settings, updateCall]);

  const sendDTMF = useCallback(async (tone) => {
    const activeCall = findActiveCall(calls);
    if (!activeCall) return;

    if (isUdpMode(settings)) {
      try {
        const result = await window.electronAPI.sip.sendDTMF(activeCall.id, tone);
        if (!result?.success) throw new Error(result?.error || 'Failed to send DTMF');
      } catch (error) {
        toast.error(`DTMF failed: ${error.message}`);
      }
      return;
    }

    const session = webSessions.get(activeCall.id);
    if (!session) return;
    try {
      session.sendDTMF(tone);
    } catch (error) {
      console.error('DTMF error:', error);
    }
  }, [calls, settings]);

  useEffect(() => {
    if (isUdpMode(settings)) return;
    ensureRemoteAudio(settings).catch(() => {});
  }, [settings]);

  useEffect(() => {
    if (!isElectron || !isUdpMode(settings)) return;
    if (listenersBound) return;
    listenersBound = true;

    window.electronAPI.removeAllListeners();
    window.electronAPI.sip.registerEventListener();

    window.electronAPI.onConnectionStatus((status) => {
      setConnectionStatus(status);
    });

    window.electronAPI.onRegistrationStatus((status) => {
      setRegistrationStatus(status);
    });

    window.electronAPI.onIncomingCall((callData) => {
      if (settings?.do_not_disturb) {
        window.electronAPI.sip.reject(callData.id).catch(() => {});
        toast('Do not disturb is enabled: call ignored');
        return;
      }

      terminalStateNotified.delete(callData.id);
      callHistoryLogged.delete(callData.id);
      callStateSeen.delete(callData.id);
      setIncomingCallData(callData);
      addCall({
        ...callData,
        direction: 'incoming',
        status: 'ringing',
        startTime: new Date(),
      });
      toast.info(`Incoming call from ${callData.displayName || callData.number}`);
    });

    window.electronAPI.onCallStateChange((event) => {
      if (!event?.id || !event?.state) return;
      const normalizedState = String(event.state).toLowerCase();
      const prevState = callStateSeen.get(event.id);
      if (prevState === normalizedState) return;
      callStateSeen.set(event.id, normalizedState);

      updateCall(event.id, { status: normalizedState });
      const isTerminalState = TERMINAL_STATES.includes(normalizedState);
      if (isTerminalState && incomingCallRef.current?.id === event.id) {
        setIncomingCallData(null);
      }
      if (isTerminalState && terminalStateNotified.has(event.id)) {
        callStateSeen.delete(event.id);
        return;
      }

      const toastId = `call-state-${event.id}`;
      if (normalizedState === 'connected') {
        stopRingback();
        toast.success('Call connected', { id: toastId });
      } else if (normalizedState === 'ringing') {
        const currentCall = findCallForEvent(callsRef.current, event.id);
        if ((currentCall?.direction || '').toLowerCase() === 'outgoing') {
          startRingback().catch(() => {});
          toast('Calling...', { id: toastId });
        }
      } else if (normalizedState === 'failed') {
        terminalStateNotified.add(event.id);
        stopRingback();
        playHangupTone().catch(() => {});
        if (!callHistoryLogged.has(event.id)) {
          const currentCall = findCallForEvent(callsRef.current, event.id);
          const number = sanitizeText(currentCall?.number || currentCall?.displayName || '');
          const normalizedNumber = number && number.toLowerCase() !== 'unknown' ? number : 'Unknown number';
          const start = currentCall?.startTime ? new Date(currentCall.startTime).getTime() : null;
          const duration = start ? Math.max(0, Math.round((Date.now() - start) / 1000)) : 0;
          addToHistory({
            id: event.id,
            number: normalizedNumber,
            displayName: normalizedNumber,
            direction: currentCall?.direction || 'outgoing',
            status: 'failed',
            duration,
            timestamp: new Date(),
          });
          callHistoryLogged.add(event.id);
        }
        const currentCall = findCallForEvent(callsRef.current, event.id);
        const isIncoming = (currentCall?.direction || '').toLowerCase() === 'incoming';
        toast.error(isIncoming ? 'Missed call' : 'Call failed', { id: toastId });
        callStateSeen.delete(event.id);
      } else if (normalizedState === 'ended') {
        terminalStateNotified.add(event.id);
        stopRingback();
        playHangupTone().catch(() => {});
        if (!callHistoryLogged.has(event.id)) {
          const currentCall = findCallForEvent(callsRef.current, event.id);
          const number = sanitizeText(currentCall?.number || currentCall?.displayName || '');
          const normalizedNumber = number && number.toLowerCase() !== 'unknown' ? number : 'Unknown number';
          const start = currentCall?.startTime ? new Date(currentCall.startTime).getTime() : null;
          const duration = start ? Math.max(0, Math.round((Date.now() - start) / 1000)) : 0;
          addToHistory({
            id: event.id,
            number: normalizedNumber,
            displayName: normalizedNumber,
            direction: currentCall?.direction || 'outgoing',
            status: 'completed',
            duration,
            timestamp: new Date(),
          });
          callHistoryLogged.add(event.id);
        }
        toast('Call ended', { id: toastId });
        callStateSeen.delete(event.id);
      }
    });

    window.electronAPI.onCallNotification((payload) => {
      if (!payload?.message) return;
      if (/^call ended$/i.test(payload.message) || /^call failed$/i.test(payload.message)) return;
      const toastId = `call-note-${payload.callId || 'global'}`;
      if (payload.level === 'error') toast.error(payload.message, { id: toastId });
      else if (payload.level === 'success') toast.success(payload.message, { id: toastId });
      else toast(payload.message, { id: toastId });
    });

    if (window.electronAPI.onEngineError) {
      window.electronAPI.onEngineError((payload) => {
        if (!payload?.message) return;
        toast.error(`Engine: ${payload.message}`, { id: `engine-${payload.code || 'err'}` });
      });
    }

    if (window.electronAPI.onSipEvent) {
      window.electronAPI.onSipEvent((evt) => {
        if (evt?.type === 'call_media_state' && evt?.payload?.callId) {
          if (evt.payload.mediaActive) {
            updateCall(evt.payload.callId, { status: 'connected' });
            toast.success('Audio media active', { id: `media-${evt.payload.callId}` });
          } else {
            toast('Audio media inactive', { id: `media-${evt.payload.callId}` });
          }
        }
      });
    }
  }, [addCall, addToHistory, playHangupTone, setConnectionStatus, setIncomingCallData, setRegistrationStatus, settings, startRingback, stopRingback, updateCall]);

  return {
    connect,
    disconnect,
    makeCall,
    answerCall,
    rejectCall,
    hangupCall,
    transferCall,
    muteCall,
    holdCall,
    sendDTMF,
    isMuted,
    isOnHold,
  };
};

