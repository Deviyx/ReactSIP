import React from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';
import { useSIP } from '../hooks/useSIP';

const IncomingCall = () => {
  const { incomingCallData } = useSIPContext();
  const { answerCall, rejectCall } = useSIP();

  if (!incomingCallData) return null;

  return (
    <div className="incoming-overlay">
      <div className="incoming-card">
        <div className="incoming-avatar">
          <Phone size={42} />
        </div>

        <p className="incoming-label">Incoming call</p>
        <h2 className="incoming-name">{incomingCallData.displayName}</h2>
        <p className="incoming-number">{incomingCallData.number}</p>

        <div className="incoming-bars" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <span key={i} style={{ animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>

        <div className="incoming-actions">
          <button
            type="button"
            onClick={() => rejectCall(incomingCallData.id)}
            className="incoming-btn incoming-decline"
            aria-label="Ignore call"
            title="Ignore call"
          >
            <PhoneOff size={26} />
            <span>Ignore</span>
          </button>

          <button
            type="button"
            onClick={() => answerCall(incomingCallData.id)}
            className="incoming-btn incoming-accept"
            aria-label="Answer call"
            title="Answer call"
          >
            <Phone size={26} />
            <span>Answer</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;
