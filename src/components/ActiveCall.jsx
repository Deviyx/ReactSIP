import React, { useEffect, useRef, useState } from 'react';
import { Mic, PauseCircle, PhoneOff, UserRound, Volume2 } from 'lucide-react';
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
  const pressTimerRef = useRef(null);

  const activeCall = [...calls].reverse().find((call) => call && !['ended', 'failed'].includes(call.status));
  if (!activeCall) return null;

  const timer = useCallTimer(activeCall.startTime);

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
  }, []);

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
