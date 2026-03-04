import React, { useEffect, useMemo, useState } from 'react';
import { MessageSquareText, Trash2 } from 'lucide-react';

const TranscriptionWindow = () => {
  const [entries, setEntries] = useState([]);
  const [status, setStatus] = useState('Idle');

  useEffect(() => {
    if (!window.electronAPI?.onTranscriptionEvent) return undefined;

    window.electronAPI.onTranscriptionEvent((event) => {
      if (!event?.type) return;
      if (event.type === 'transcript' && event.payload?.text) {
        setStatus('Listening');
        setEntries((prev) => {
          const now = Date.now();
          const speaker = String(event.payload.speaker || 'unknown');
          const text = String(event.payload.text || '').trim();
          const normalized = text.toLowerCase().replace(/\s+/g, ' ');
          if (!normalized) return prev;

          const last = prev[prev.length - 1];
          if (last) {
            const lastNorm = String(last.text || '').toLowerCase().replace(/\s+/g, ' ');
            const isDuplicateSpeaker = String(last.speaker || 'unknown') === speaker;
            const isDuplicateText = lastNorm === normalized;
            const isNearInTime = Math.abs(now - new Date(last.time).getTime()) < 4500;
            if (isDuplicateSpeaker && isDuplicateText && isNearInTime) {
              return prev;
            }
          }

          return [
            ...prev,
            {
              id: `${now}_${Math.random().toString(16).slice(2, 8)}`,
              speaker,
              text,
              time: new Date(now),
            },
          ];
        });
        return;
      }

      if (event.type === 'error') {
        setStatus(event.payload?.message || 'Transcription error');
        return;
      }

      if (event.type === 'session_started') {
        setStatus('Listening');
        return;
      }

      if (event.type === 'session_stopped') {
        setStatus('Stopped');
        return;
      }

      if (event.type === 'engine_ready') {
        if (event.payload?.importError) {
          setStatus(`faster-whisper missing: ${event.payload.importError}`);
        } else {
          setStatus('Engine ready');
        }
      }
    });

    return undefined;
  }, []);

  const grouped = useMemo(() => entries.slice(-300), [entries]);

  return (
    <div className="transcription-page">
      <header className="transcription-header">
        <div className="transcription-title-wrap">
          <MessageSquareText size={20} />
          <h1>Live Transcript</h1>
        </div>
        <button type="button" className="icon-btn" onClick={() => setEntries([])} title="Clear transcript">
          <Trash2 size={16} />
        </button>
      </header>

      <div className="transcription-status">{status}</div>

      <div className="transcription-list">
        {grouped.length === 0 ? (
          <div className="transcription-empty">No speech captured yet.</div>
        ) : (
          grouped.map((entry) => {
            const isAgent = String(entry.speaker).toLowerCase() === 'agent';
            return (
              <div key={entry.id} className={`transcription-item ${isAgent ? 'transcription-agent' : 'transcription-client'}`}>
                <div className="transcription-item-head">
                  <span className="transcription-speaker">{isAgent ? 'Agent' : 'Client'}</span>
                  <span className="transcription-time">{entry.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </div>
                <div className="transcription-text">{entry.text}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TranscriptionWindow;
