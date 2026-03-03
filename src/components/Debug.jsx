import React, { useEffect, useRef, useState } from 'react';
import { Bug, Clipboard, Trash2 } from 'lucide-react';

const MAX_LOGS = 220;

const Debug = () => {
  const [logs, setLogs] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    const push = (level, args) => {
      const line = args.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(' ');
      setLogs((prev) => {
        const next = [...prev, { ts: new Date().toLocaleTimeString(), level, line }];
        return next.slice(-MAX_LOGS);
      });
    };

    console.log = (...args) => {
      push('log', args);
      originalLog(...args);
    };
    console.warn = (...args) => {
      push('warn', args);
      originalWarn(...args);
    };
    console.error = (...args) => {
      push('error', args);
      originalError(...args);
    };

    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  const onCopy = async () => {
    const text = logs.map((l) => `[${l.ts}] [${l.level}] ${l.line}`).join('\n');
    if (text) {
      await navigator.clipboard.writeText(text);
    }
  };

  const onClear = () => setLogs([]);

  return (
    <div className="surface-card debug-root">
      <div className="debug-head">
        <div className="debug-title-wrap">
          <Bug size={15} />
          <h3>Debug SIP</h3>
        </div>

        <div className="debug-actions">
          <button className="icon-btn" type="button" onClick={onCopy} title="Copiar logs">
            <Clipboard size={14} />
          </button>
          <button className="icon-btn" type="button" onClick={onClear} title="Limpar logs">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="debug-body">
        {logs.length === 0 ? (
          <p className="debug-empty">Sem logs ainda.</p>
        ) : (
          logs.map((entry, index) => (
            <div key={`${entry.ts}-${index}`} className={`debug-line debug-${entry.level}`}>
              <span className="debug-time">[{entry.ts}]</span>
              <span>{entry.line}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default Debug;
