import React from 'react';
import { Phone, PhoneIncoming, PhoneOff, Clock } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';
import { useSIP } from '../hooks/useSIP';

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
    if (!raw) return 'Número não identificado';
    const normalized = normalizeLabel(raw);
    if (normalized.toLowerCase() === 'unknown') return 'Número não identificado';
    if (!normalized) return 'Número não identificado';
    return normalized;
  };

  if (callHistory.length === 0) {
    return (
      <div className="surface-card page-center">
        <Clock size={40} className="empty-icon" />
        <p className="empty-title">Sem histórico de chamadas</p>
      </div>
    );
  }

  return (
    <div className="surface-card page-scroll history-root">
      <h2 className="section-title">Histórico</h2>

      <div className="list-stack">
        {[...callHistory].reverse().map((call, index) => {
          const callNumber = getCallNumber(call);
          const canRecall = callNumber !== 'Número não identificado';

          return (
            <div key={`${call.timestamp}-${index}`} className="history-item">
              <div className="history-left">
                <div className={`history-icon ${call.direction === 'incoming' ? 'history-in' : 'history-out'}`}>
                  {call.direction === 'incoming' ? <PhoneIncoming size={16} /> : call.status === 'completed' ? <Phone size={16} /> : <PhoneOff size={16} />}
                </div>
                <div className="history-meta">
                  <div className="history-number">{callNumber}</div>
                  <div className="history-sub">{formatDateTime(call.timestamp)}{call.status === 'completed' ? ` - ${formatDuration(call.duration)}` : ''}</div>
                </div>
              </div>
              <button type="button" onClick={() => makeCall(callNumber)} className="mini-call-btn" disabled={!canRecall}>Ligar</button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CallHistory;
