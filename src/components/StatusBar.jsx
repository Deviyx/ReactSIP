import React from 'react';
import { Minus, Moon, Square, Sun, Wifi, X } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';

const StatusBar = ({ theme, onToggleTheme }) => {
  const { settings, connectionStatus, registrationStatus, sipUri } = useSIPContext();
  const [isMaximized, setIsMaximized] = React.useState(false);

  const isRegistered = registrationStatus === 'Registered';
  const isConnected = connectionStatus === 'Connected';
  const fullSip = sipUri || `sip:${settings.username || 'user'}@${settings.domain || 'server'}`;
  const userPart = settings.username || fullSip.replace(/^sip:/i, '').split('@')[0] || 'user';

  const dotClass = isRegistered
    ? 'status-ok'
    : isConnected
      ? 'status-warn'
      : 'status-off';

  React.useEffect(() => {
    if (!window.electronAPI?.onWindowState) return undefined;
    window.electronAPI.onWindowState((state) => {
      setIsMaximized(Boolean(state?.maximized));
    });
    return undefined;
  }, []);

  const minimize = () => window.electronAPI?.app?.minimizeWindow?.();
  const maximize = () => window.electronAPI?.app?.toggleMaximizeWindow?.();
  const close = () => window.electronAPI?.app?.closeWindow?.();

  return (
    <header className="status-bar">
      <div className="status-left">
        <span className={`status-dot ${dotClass}`} />
        <Wifi size={14} className={`status-icon ${dotClass}`} />
        <div>
          <p className="status-label">Linha</p>
          <p className={`status-value ${dotClass}`}>{isRegistered ? 'Online' : connectionStatus}</p>
        </div>
      </div>

      <div className="status-right">
        <div className="status-identity">
          <p className="status-user">{userPart}</p>
          <p className="status-uri">{fullSip}</p>
        </div>
        <button className="theme-switch" type="button" onClick={onToggleTheme} aria-label="Alternar tema">
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <div className="status-window-actions">
          <button type="button" className="status-window-btn" onClick={minimize} aria-label="Minimizar">
            <Minus size={12} />
          </button>
          <button
            type="button"
            className="status-window-btn"
            onClick={maximize}
            aria-label={isMaximized ? 'Restaurar' : 'Maximizar'}
          >
            <Square size={10} />
          </button>
          <button type="button" className="status-window-btn status-window-btn-close" onClick={close} aria-label="Fechar">
            <X size={12} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default StatusBar;
