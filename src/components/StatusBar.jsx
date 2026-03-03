import React from 'react';
import { BellOff, Minus, Moon, Square, Sun, Wifi, X } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';

const StatusBar = ({ theme, onToggleTheme }) => {
  const { settings, setSettings, connectionStatus, registrationStatus, sipUri } = useSIPContext();
  const [isMaximized, setIsMaximized] = React.useState(false);

  const isRegistered = registrationStatus === 'Registered';
  const isConnected = connectionStatus === 'Connected';
  const fullSip = sipUri || `sip:${settings.username || 'user'}@${settings.domain || 'server'}`;
  const userPart = settings.username || fullSip.replace(/^sip:/i, '').split('@')[0] || 'user';
  const lineText = isRegistered ? userPart : connectionStatus;

  const dotClass = isRegistered ? 'status-ok' : isConnected ? 'status-warn' : 'status-off';

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
        <span className={`status-dot ${dotClass}`} title={isRegistered ? 'Registered' : 'Not registered'} />
        <Wifi size={14} className={`status-icon ${dotClass}`} title="Line status" />
        <div>
          <p className="status-label">Line</p>
          <p className={`status-value ${dotClass}`}>{lineText}</p>
        </div>
      </div>

      <div className="status-right">
        <p className="status-uri status-uri-standalone">{fullSip}</p>
        <button
          className={`theme-switch ${settings?.do_not_disturb ? 'theme-switch-active' : ''}`}
          type="button"
          onClick={() => setSettings({ do_not_disturb: !settings?.do_not_disturb })}
          aria-label={settings?.do_not_disturb ? 'Disable do not disturb' : 'Enable do not disturb'}
          title={settings?.do_not_disturb ? 'Do not disturb is enabled' : 'Enable do not disturb'}
        >
          <BellOff size={15} />
        </button>
        <button className="theme-switch" type="button" onClick={onToggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {theme === 'light' ? <Moon size={15} /> : <Sun size={15} />}
        </button>
        <div className="status-window-actions">
          <button type="button" className="status-window-btn" onClick={minimize} aria-label="Minimize" title="Minimize">
            <Minus size={12} />
          </button>
          <button
            type="button"
            className="status-window-btn"
            onClick={maximize}
            aria-label={isMaximized ? 'Restore' : 'Maximize'}
            title={isMaximized ? 'Restore' : 'Maximize'}
          >
            <Square size={10} />
          </button>
          <button type="button" className="status-window-btn status-window-btn-close" onClick={close} aria-label="Close" title="Close">
            <X size={12} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default StatusBar;
