import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Captions, Mic, PauseCircle, PhoneOff, UserRound, Volume2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useSIPContext } from '../context/SIPContext';
import { useSIP } from '../hooks/useSIP';
import { useCallTimer } from '../hooks/useCallTimer';
import { useDtmfTone } from '../hooks/useDtmfTone';

const DTMF = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

const ActiveCall = () => {
  const { calls } = useSIPContext();
  const { hangupCall, transferCall, muteCall, holdCall, sendDTMF, isMuted, isOnHold } = useSIP();
  const { playTone } = useDtmfTone();
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState('');
  const [pressedTone, setPressedTone] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const pressTimerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const localRecorderRef = useRef(null);
  const remoteRecorderRef = useRef(null);

  const activeCall = [...calls].reverse().find((call) => call && !['ended', 'failed'].includes(call.status));
  if (!activeCall) return null;

  const timer = useCallTimer(activeCall.startTime);

  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    const step = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += step) {
      const chunk = bytes.subarray(i, i + step);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  };

  const getRecorderMimeType = () => {
    const candidates = ['audio/webm;codecs=opus', 'audio/webm'];
    return candidates.find((value) => MediaRecorder.isTypeSupported(value)) || '';
  };

  const stopTranscriptionCapture = useCallback(async () => {
    [localRecorderRef.current, remoteRecorderRef.current].forEach((recorder) => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    });
    localRecorderRef.current = null;
    remoteRecorderRef.current = null;

    [localStreamRef.current, remoteStreamRef.current].forEach((stream) => {
      stream?.getTracks?.().forEach((track) => track.stop());
    });
    localStreamRef.current = null;
    remoteStreamRef.current = null;

    try {
      await window.electronAPI?.transcription?.stop?.();
    } catch {
      // noop
    }
    try {
      await window.electronAPI?.app?.closeTranscriptionWindow?.();
    } catch {
      // noop
    }

    setTranscribing(false);
  }, []);

  const startRecorder = useCallback((stream, speaker, callId) => {
    if (!stream) return null;
    const mimeType = getRecorderMimeType();
    const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = async (event) => {
      if (!event.data || event.data.size < 3000) return;
      try {
        const buffer = await event.data.arrayBuffer();
        await window.electronAPI?.transcription?.pushChunk?.({
          speaker,
          mimeType: event.data.type || mimeType || 'audio/webm',
          audioBase64: arrayBufferToBase64(buffer),
          callId,
        });
      } catch {
        // noop
      }
    };
    recorder.start(3500);
    return recorder;
  }, []);

  const startTranscriptionCapture = useCallback(async () => {
    try {
      await window.electronAPI?.app?.openTranscriptionWindow?.();

      const started = await window.electronAPI?.transcription?.start?.({
        model: 'base',
        language: 'pt',
        device: 'cpu',
        compute_type: 'int8',
      });
      if (!started?.success) {
        toast.error(`Transcription unavailable: ${started?.error || 'unknown error'}`);
        return;
      }

      const localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      localStreamRef.current = localStream;
      localRecorderRef.current = startRecorder(localStream, 'agent', activeCall.id);

      const remoteEl = window.__reactsipRemoteAudioEl;
      const remoteStream = remoteEl?.captureStream?.() || remoteEl?.mozCaptureStream?.() || null;
      if (remoteStream && remoteStream.getAudioTracks().length > 0) {
        remoteStreamRef.current = remoteStream;
        remoteRecorderRef.current = startRecorder(remoteStream, 'client', activeCall.id);
      } else {
        toast('Client audio capture is not available yet');
      }

      setTranscribing(true);
      toast.success('Live transcription started');
    } catch (error) {
      toast.error(`Transcription error: ${error?.message || 'unknown'}`);
      await stopTranscriptionCapture();
    }
  }, [activeCall.id, startRecorder, stopTranscriptionCapture]);

  const onTransfer = () => {
    if (!transferTarget.trim()) return;
    transferCall(activeCall.id, transferTarget.trim());
    setTransferOpen(false);
    setTransferTarget('');
  };

  const onTransferKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onTransfer();
    }
  };

  const onDTMF = (tone) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    setPressedTone(tone);
    pressTimerRef.current = setTimeout(() => setPressedTone(null), 120);
    playTone(tone);
    if (transferOpen) {
      setTransferTarget((prev) => `${prev}${tone}`);
      return;
    }
    sendDTMF(tone);
  };

  const meter = activeCall.status === 'connected' ? 82 : activeCall.status === 'ringing' ? 58 : 36;

  useEffect(() => () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    stopTranscriptionCapture().catch(() => {});
  }, [stopTranscriptionCapture]);

  return (
    <div className="surface-card active-call-layout">
      <div className="active-avatar-wrap">
        <div className="active-avatar">
          <UserRound size={42} />
        </div>
        <div className="active-name">{activeCall.displayName || activeCall.number}</div>
        <div className="active-number">{activeCall.number}</div>
        <div className="active-timer">{timer}</div>
      </div>

      <div className="active-meter">
        <div className="meter-head">
          <Volume2 size={12} />
          Signal
        </div>
        <div className="meter-track">
          <div className="meter-fill" style={{ width: `${meter}%` }} />
        </div>
      </div>

      <div className="active-actions-row">
        <button type="button" className={`state-btn ${isMuted ? 'state-btn-on' : ''}`} onClick={muteCall} title={isMuted ? 'Unmute microphone' : 'Mute microphone'}>
          <Mic size={16} />
          {isMuted ? 'Muted' : 'Mute'}
        </button>
        <button type="button" className={`state-btn ${isOnHold ? 'state-btn-on' : ''}`} onClick={holdCall} title={isOnHold ? 'Resume call' : 'Put on hold'}>
          <PauseCircle size={16} />
          {isOnHold ? 'Resume' : 'Hold'}
        </button>
        <button type="button" className={`state-btn ${transferOpen ? 'state-btn-on' : ''}`} onClick={() => setTransferOpen((prev) => !prev)} title="Transfer call">
          <UserRound size={16} />
          Transfer
        </button>
      </div>

      <button
        type="button"
        className={`secondary-btn ${transcribing ? 'state-btn-on' : ''}`}
        onClick={() => (transcribing ? stopTranscriptionCapture() : startTranscriptionCapture())}
        title={transcribing ? 'Stop live transcription' : 'Start live transcription'}
      >
        <Captions size={16} />
        {transcribing ? 'Stop Transcript' : 'Live Transcript'}
      </button>

      {transferOpen && (
        <div className="transfer-panel">
          <input
            type="text"
            value={transferTarget}
            onChange={(e) => setTransferTarget(e.target.value)}
            onKeyDown={onTransferKeyDown}
            className="field-input"
            placeholder="SIP number for transfer"
          />
          <div className="transfer-actions">
            <button type="button" className="secondary-btn" onClick={() => setTransferOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary-btn" onClick={onTransfer}>
              Confirm
            </button>
          </div>
        </div>
      )}

      <div className="dtmf-grid">
        {DTMF.map((tone) => (
          <button
            key={tone}
            type="button"
            className={`dtmf-btn ${pressedTone === tone ? 'dtmf-btn-pressed' : ''}`}
            onClick={() => onDTMF(tone)}
            title={`Send DTMF ${tone}`}
          >
            {tone}
          </button>
        ))}
      </div>

      <button type="button" className="danger-btn hangup-btn" onClick={() => hangupCall(activeCall.id)} title="End call">
        <PhoneOff size={16} />
        Hang up
      </button>
    </div>
  );
};

export default ActiveCall;
