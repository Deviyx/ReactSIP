import React from 'react';
import { Phone, PhoneIncoming, PhoneOff, Clock } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';
import { useSIP } from '../hooks/useSIP';

const UNKNOWN_NUMBER = 'Unknown number';

const CallHistory = () => {
  const { callHistory } = useSIPContext();
  const { makeCall } = useSIP();
  const normalizeLabel = (value) => String(value || '').replace(/[\u0000-\u001F\u007F]+/g, ' ').trim();

  const formatDuration = (seconds) => {
    if (!seconds) return '--';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatDateTime = (date) => {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return '--';
    return d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

  const getCallNumber = (call) => {
    const raw = [call?.number, call?.displayName].find((v) => v && String(v).trim());
    if (!raw) return UNKNOWN_NUMBER;
    const normalized = normalizeLabel(raw);
    if (normalized.toLowerCase() === 'unknown') return UNKNOWN_NUMBER;
    if (!normalized) return UNKNOWN_NUMBER;
    return normalized;
  };

  const getHistoryIconMeta = (call) => {
    if (call.direction === 'incoming') {
      return {
        icon: <PhoneIncoming size={16} />,
        title: call.status === 'completed' ? 'Answered incoming call' : 'Missed incoming call',
      };
    }
    if (call.status === 'completed') {
      return { icon: <Phone size={16} />, title: 'Completed outgoing call' };
    }
    return { icon: <PhoneOff size={16} />, title: 'Failed or ended call' };
  };

  if (callHistory.length === 0) {
    return (
      <div className="surface-card page-center">
        <Clock size={40} className="empty-icon" />
        <p className="empty-title">No call history</p>
      </div>
    );
  }

  return (
    <div className="surface-card page-scroll history-root">
      <h2 className="section-title">History</h2>
      <div className="list-stack">
        {[...callHistory].reverse().map((call, index) => {
          const callNumber = getCallNumber(call);
          const canRecall = callNumber !== UNKNOWN_NUMBER;
          const iconMeta = getHistoryIconMeta(call);

          return (
            <div key={`${call.timestamp}-${index}`} className="history-item">
              <div className="history-left">
                <div className={`history-icon ${call.direction === 'incoming' ? 'history-in' : 'history-out'}`} title={iconMeta.title}>
                  {iconMeta.icon}
                </div>
                <div className="history-meta">
                  <div className="history-number">{callNumber}</div>
                  <div className="history-sub">{formatDateTime(call.timestamp)}{call.status === 'completed' ? ` - ${formatDuration(call.duration)}` : ''}</div>
                </div>
              </div>
              <button type="button" onClick={() => makeCall(callNumber)} className="mini-call-btn" disabled={!canRecall} title={canRecall ? `Call ${callNumber}` : 'Number unavailable for redial'}>
                Call
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CallHistory;
