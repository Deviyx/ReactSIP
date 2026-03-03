import React from 'react';
import { Moon, Sun, Wifi } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';

const StatusBar = ({ theme, onToggleTheme }) => {
  const { settings, connectionStatus, registrationStatus, sipUri } = useSIPContext();

  const isRegistered = registrationStatus === 'Registered';
  const isConnected = connectionStatus === 'Connected';
  const fullSip = sipUri || `sip:${settings.username || 'user'}@${settings.domain || 'server'}`;
  const userPart = settings.username || fullSip.replace(/^sip:/i, '').split('@')[0] || 'user';

  const dotClass = isRegistered
    ? 'status-ok'
    : isConnected
      ? 'status-warn'
      : 'status-off';

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
      </div>
    </header>
  );
};

export default StatusBar;
