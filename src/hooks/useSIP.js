import { useState, useEffect, useCallback, useRef } from 'react';
import JsSIP from 'jssip';
import { useSIPContext } from '../context/SIPContext';
import toast from 'react-hot-toast';

const isElectron = window.electronAPI !== undefined;
let listenersBound = false;
const callStateSeen = new Map();
const callHistoryLogged = new Set();

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
  return value || 'Número não identificado';
};

export const useSIP = () => {
  const {
    settings,
    calls,
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

  useEffect(() => {
    callsRef.current = calls;
  }, [calls]);

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
    });

    session.on('accepted', () => {
      updateCall(callId, { status: 'ringing' });
    });

    session.on('confirmed', () => {
      updateCall(callId, { status: 'connected' });
      setSession(session);
      toast.success('Chamada conectada', { id: `call-state-${callId}` });
    });

    const finishCall = (state, reason) => {
      updateCall(callId, { status: state });
      webSessions.delete(callId);
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
          toast.error('Número não existe', { id: `call-state-${callId}` });
        } else {
          toast.error(`Falha na chamada ${statusCode ? `(${statusCode})` : ''}`, { id: `call-state-${callId}` });
        }
      } else {
        toast('Chamada encerrada', { id: `call-state-${callId}` });
      }
    };

    session.on('ended', (e) => finishCall('ended', e));
    session.on('failed', (e) => finishCall('failed', e));
  }, [addToHistory, setIncomingCallData, setSession, settings, updateCall]);

  const connectWebRTC = useCallback(async () => {
    if (!settings.username || !settings.password || !settings.domain) {
      toast.error('Preencha usuario, senha e dominio');
      return;
    }

    const wsUrl = getWsUrl(settings);
    if (!wsUrl) {
      toast.error('Configure host/porta WebSocket SIP em Config');
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
        toast.success(`Registrado via WebRTC: sip:${settings.username}@${settings.domain}`);
      });

      webUA.on('registrationFailed', (e) => {
        setRegistrationStatus('Registration Failed');
        setConnectionStatus('Disconnected');
        const reason = e?.cause || 'falha de registro';
        toast.error(`Registro WebRTC falhou: ${reason}`);
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
          toast.info(`Chamada recebida de ${displayName}`);
        } else {
          updateCall(callId, { id: callId });
        }

        await ensureRemoteAudio(settings);
      });

      webUA.start();
    } catch (error) {
      setConnectionStatus('Disconnected');
      setRegistrationStatus('Registration Failed');
      toast.error(`Erro WebRTC: ${error.message}`);
    }
  }, [addCall, attachSessionEvents, setConnectionStatus, setIncomingCallData, setRegistrationStatus, setSipUri, settings, updateCall]);

  const connect = useCallback(async () => {
    if (isUdpMode(settings)) {
      if (!isElectron) {
        toast.error('Modo UDP requer Electron');
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
            toast('Conectando via motor nativo UDP...');
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
    toast.success('Desconectado');
  }, [setConnectionStatus, setIncomingCallData, setRegistrationStatus, setSession, setSipUri, settings]);

  const makeCall = useCallback(async (number) => {
    if (!number) {
      toast.error('Please enter a number');
      return;
    }

    if (isUdpMode(settings)) {
      try {
        const result = await window.electronAPI.sip.call(number);
        if (result.success) {
          addCall({
            id: result.callId,
            number,
            displayName: number,
            direction: 'outgoing',
            status: 'calling',
            startTime: new Date(),
          });
          toast(`Ligando para ${number}...`);
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
      toast(`Ligando para ${number}...`);
    } catch (error) {
      toast.error(`Falha ao ligar: ${error.message}`);
    }
  }, [addCall, attachSessionEvents, setSession, settings]);

  const answerCall = useCallback(async (callId) => {
    if (isUdpMode(settings)) {
      try {
        const result = await window.electronAPI.sip.accept(callId);
        if (result.success) toast.success('Call accepted');
        else toast.error(`Accept failed: ${result.error}`);
      } catch (error) {
        toast.error(`Accept error: ${error.message}`);
      }
      return;
    }

    const session = webSessions.get(callId);
    if (!session) {
      toast.error('Chamada não encontrada');
      return;
    }
    try {
      session.answer({ mediaConstraints: { audio: true, video: false } });
      setIncomingCallData(null);
      toast.success('Chamada atendida');
    } catch (error) {
      toast.error(`Erro ao atender: ${error.message}`);
    }
  }, [setIncomingCallData, settings]);

  const hangupCall = useCallback(async (callId) => {
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
      toast.error(`Erro ao desligar: ${error.message}`);
    }
  }, [settings]);

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
      toast.success('Transferencia enviada');
    } catch (error) {
      toast.error(`Falha na transferência: ${error.message}`);
    }
  }, [settings]);

  const rejectCall = useCallback(async (callId) => {
    if (isUdpMode(settings)) {
      try {
        await window.electronAPI.sip.reject(callId);
      } catch (error) {
        console.error('Reject error:', error);
      }
      setIncomingCallData(null);
      toast.info('Call rejected');
      return;
    }

    const session = webSessions.get(callId);
    if (!session) return;
    try {
      session.terminate({ status_code: 486, reason_phrase: 'Busy Here' });
      setIncomingCallData(null);
      toast('Chamada recusada');
    } catch (error) {
      toast.error(`Erro ao recusar: ${error.message}`);
    }
  }, [setIncomingCallData, settings]);

  const muteCall = useCallback(async () => {
    const activeCall = findActiveCall(calls);
    if (!activeCall) return;

    if (isUdpMode(settings)) {
      const next = !isMuted;
      try {
        const result = await window.electronAPI.sip.mute(activeCall.id, next);
        if (!result?.success) throw new Error(result?.error || 'Falha ao mutar');
        setIsMutedLocal(next);
        setMuted(next);
        toast.success(next ? 'Microfone mutado' : 'Microfone reativado', { id: `mute-${activeCall.id}` });
      } catch (error) {
        toast.error(`Falha ao alterar mute: ${error.message}`);
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
        if (!result?.success) throw new Error(result?.error || 'Falha ao colocar em espera');
        setIsOnHoldLocal(next);
        setOnHold(next);
        updateCall(activeCall.id, { status: next ? 'holding' : 'connected' });
        toast.success(next ? 'Chamada em espera' : 'Chamada retomada', { id: `hold-${activeCall.id}` });
      } catch (error) {
        toast.error(`Falha no hold: ${error.message}`);
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
        if (!result?.success) throw new Error(result?.error || 'Falha ao enviar DTMF');
      } catch (error) {
        toast.error(`DTMF falhou: ${error.message}`);
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
      const prevState = callStateSeen.get(event.id);
      if (prevState === event.state) return;
      callStateSeen.set(event.id, event.state);

      updateCall(event.id, { status: event.state });
      const toastId = `call-state-${event.id}`;
      if (event.state === 'connected') toast.success('Call connected', { id: toastId });
      else if (event.state === 'ringing') toast('Calling...', { id: toastId });
      else if (event.state === 'failed') {
        if (!callHistoryLogged.has(event.id)) {
          const currentCall = findCallForEvent(callsRef.current, event.id);
          const number = sanitizeText(currentCall?.number || currentCall?.displayName || '');
          const normalizedNumber = number && number.toLowerCase() !== 'unknown' ? number : 'Número não identificado';
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
        toast.error('Call failed', { id: toastId });
        callStateSeen.delete(event.id);
      } else if (event.state === 'ended') {
        if (!callHistoryLogged.has(event.id)) {
          const currentCall = findCallForEvent(callsRef.current, event.id);
          const number = sanitizeText(currentCall?.number || currentCall?.displayName || '');
          const normalizedNumber = number && number.toLowerCase() !== 'unknown' ? number : 'Número não identificado';
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
            toast.success('Midia de audio ativa', { id: `media-${evt.payload.callId}` });
          } else {
            toast('Midia de audio inativa', { id: `media-${evt.payload.callId}` });
          }
        }
      });
    }
  }, [addCall, setConnectionStatus, setIncomingCallData, setRegistrationStatus, settings, updateCall]);

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
