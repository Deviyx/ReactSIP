import React, { useEffect, useState } from 'react';
import {
  Settings as SettingsIcon,
  Copy,
  Check,
  Info,
  Mic,
  Speaker,
  Volume2,
  AlertTriangle,
  SlidersHorizontal,
  Radio,
  Cpu,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSIPContext } from '../context/SIPContext';
import { useSIP } from '../hooks/useSIP';
import { useAudio } from '../hooks/useAudio';

const SETTINGS_TABS = [
  { id: 'sip', label: 'SIP', icon: Radio },
  { id: 'audio', label: 'Audio', icon: Volume2 },
  { id: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
];

const Settings = () => {
  const { settings, setSettings, registrationStatus, connectionStatus } = useSIPContext();
  const { connect, disconnect } = useSIP();
  const {
    micPermission,
    micLevel,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    inputVolume,
    outputVolume,
    isMonitoringInput,
    selectInputDevice,
    selectOutputDevice,
    setInputVolume,
    setOutputVolume,
    startInputMonitoring,
    stopInputMonitoring,
    playOutputTestTone,
    requestMicrophone,
  } = useAudio({ autoRequest: false });

  const [copiedSipUri, setCopiedSipUri] = useState(false);
  const [engineStatus, setEngineStatus] = useState('unknown');
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [activeTab, setActiveTab] = useState('sip');

  useEffect(() => {
    if (settings.audio_input_volume != null) setInputVolume(settings.audio_input_volume);
    if (settings.audio_output_volume != null) setOutputVolume(settings.audio_output_volume);
    if (settings.audio_output_device_id) selectOutputDevice(settings.audio_output_device_id).catch(() => {});
  }, [
    settings.audio_input_volume,
    settings.audio_output_volume,
    settings.audio_output_device_id,
    setInputVolume,
    setOutputVolume,
    selectOutputDevice,
  ]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setSettings({ [name]: value });
  };

  const handleSelectInput = async (deviceId) => {
    await selectInputDevice(deviceId);
    setSettings({ audio_input_device_id: deviceId });
  };

  const handleSelectOutput = async (deviceId) => {
    await selectOutputDevice(deviceId);
    setSettings({ audio_output_device_id: deviceId });
  };

  const handleInputVolume = (value) => {
    setInputVolume(value);
    setSettings({ audio_input_volume: Number(value) });
  };

  const handleOutputVolume = (value) => {
    setOutputVolume(value);
    setSettings({ audio_output_volume: Number(value) });
  };

  const handleConnect = () => {
    if (!settings.username || !settings.password || !settings.domain) {
      alert('Please fill username, password, and domain.');
      return;
    }
    connect();
  };

  const sipUri = `sip:${settings.username || 'user'}@${settings.domain || 'server'}`;
  const usingWebRTC = (settings.transport || 'udp').toLowerCase() !== 'udp';

  const checkEngine = async () => {
    if (!window.electronAPI?.sip?.pingEngine) return;
    const result = await window.electronAPI.sip.pingEngine();
    if (result?.success) setEngineStatus(result.engine === 'native' ? 'native active' : 'legacy/fallback');
    else setEngineStatus(`error: ${result?.error || 'unavailable'}`);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sipUri);
    setCopiedSipUri(true);
    setTimeout(() => setCopiedSipUri(false), 1200);
  };

  const checkUpdates = async () => {
    if (!window.electronAPI?.app?.checkForUpdates) {
      toast.error('Updater unavailable in this environment');
      return;
    }

    setCheckingUpdate(true);
    try {
      const result = await window.electronAPI.app.checkForUpdates();
      if (!result?.success) toast.error(result?.error || 'Failed to check for updates');
      else toast.success('Update check started');
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleCompactModeToggle = async (enabled) => {
    setSettings({ hyper_compact_mode: enabled });
    try {
      await window.electronAPI?.app?.setHyperCompactMode?.(enabled);
    } catch {
      // noop
    }
  };

  return (
    <div className="surface-card page-scroll settings-root">
      <div className="section-title-row">
        <SettingsIcon size={20} className="accent-icon" />
        <h2 className="section-title settings-title">Settings</h2>
      </div>

      <div className="settings-tabs" role="tablist" aria-label="Settings tabs">
        {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            className={`settings-tab-btn ${activeTab === id ? 'settings-tab-btn-active' : ''}`}
            onClick={() => setActiveTab(id)}
            title={label}
          >
            <Icon size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {activeTab === 'sip' && (
        <>
          <div className="panel-card panel-card-highlight">
            <div className="meta-grid settings-meta-grid">
              <div className="meta-tile">
                <div className="meta-label">Registration</div>
                <div className="meta-value">{registrationStatus}</div>
              </div>
              <div className="meta-tile">
                <div className="meta-label">Connection</div>
                <div className="meta-value">{connectionStatus}</div>
              </div>
            </div>

            <div className="field-group">
              <div className="meta-label">SIP URI</div>
              <div className="sip-box">
                <code className="sip-code">{sipUri}</code>
                <button onClick={copyToClipboard} className="icon-btn" type="button" title="Copy SIP URI">
                  {copiedSipUri ? <Check size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>

          <div className="panel-card">
            <h3 className="panel-title">SIP Account</h3>

            <div className="field-group">
              <label className="field-label">Display Name</label>
              <input
                type="text"
                name="display_name"
                value={settings.display_name}
                onChange={handleChange}
                disabled={registrationStatus === 'Registered'}
                className="field-input"
              />
            </div>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label">Username</label>
                <input
                  type="text"
                  name="username"
                  value={settings.username}
                  onChange={handleChange}
                  disabled={registrationStatus === 'Registered'}
                  className="field-input"
                />
              </div>
              <div className="field-group">
                <label className="field-label">Password</label>
                <input
                  type="password"
                  name="password"
                  value={settings.password}
                  onChange={handleChange}
                  disabled={registrationStatus === 'Registered'}
                  className="field-input"
                />
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">Domain/IP</label>
              <input
                type="text"
                name="domain"
                value={settings.domain}
                onChange={handleChange}
                disabled={registrationStatus === 'Registered'}
                className="field-input"
              />
            </div>
          </div>

          <div className="info-box">
            <Info size={16} />
            <span>
              {usingWebRTC
                ? 'WebRTC mode active: requires SIP over WS/WSS for real bidirectional audio.'
                : 'Native UDP mode: uses SIP/RTP sidecar for bidirectional audio (with legacy fallback).'}
            </span>
          </div>
        </>
      )}

      {activeTab === 'audio' && (
        <div className="panel-card">
          <h3 className="panel-title">Audio Devices and Volume</h3>

          <div className="field-group">
            <label className="field-label"><Mic size={14} /> Input (microphone)</label>
            <select
              className="field-input"
              value={settings.audio_input_device_id || selectedInputDeviceId || 'default'}
              onChange={(e) => handleSelectInput(e.target.value)}
            >
              <option value="default">System default</option>
              {inputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Microphone ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label className="field-label"><Speaker size={14} /> Output (speaker)</label>
            <select
              className="field-input"
              value={settings.audio_output_device_id || selectedOutputDeviceId || 'default'}
              onChange={(e) => handleSelectOutput(e.target.value)}
            >
              <option value="default">System default</option>
              {outputDevices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || `Output ${device.deviceId.slice(0, 6)}`}
                </option>
              ))}
            </select>
          </div>

          <div className="field-group">
            <label className="field-label">Input volume: {Math.round(settings.audio_input_volume ?? inputVolume)}%</label>
            <input
              type="range"
              min="0"
              max="150"
              value={settings.audio_input_volume ?? inputVolume}
              onChange={(e) => handleInputVolume(e.target.value)}
              className="field-range"
            />
            <div className="meter-track">
              <div className="meter-fill" style={{ width: `${micLevel}%` }} />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label">Output volume: {Math.round(settings.audio_output_volume ?? outputVolume)}%</label>
            <input
              type="range"
              min="0"
              max="150"
              value={settings.audio_output_volume ?? outputVolume}
              onChange={(e) => handleOutputVolume(e.target.value)}
              className="field-range"
            />
          </div>

          <div className="field-row inline-actions">
            <button type="button" className="secondary-btn" onClick={playOutputTestTone}>
              <Volume2 size={14} />
              Test output
            </button>
            {isMonitoringInput ? (
              <button type="button" className="secondary-btn" onClick={stopInputMonitoring}>
                Stop microphone loopback
              </button>
            ) : (
              <button type="button" className="secondary-btn" onClick={startInputMonitoring}>
                Monitor my microphone
              </button>
            )}
          </div>

          {micPermission === false && (
            <div className="info-box" style={{ marginTop: 10 }}>
              <AlertTriangle size={16} />
              <span>Microphone permission is missing. Click to enable.</span>
              <button type="button" className="icon-btn" onClick={() => requestMicrophone().catch(() => {})} title="Try again">
                <Mic size={14} />
              </button>
              <button
                type="button"
                className="secondary-btn"
                style={{ minHeight: 32, width: 'auto', padding: '0 10px' }}
                onClick={() => window.electronAPI?.app?.openMicrophonePrivacySettings?.()}
              >
                Open privacy settings
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'advanced' && (
        <>
          <div className="panel-card">
            <h3 className="panel-title">Advanced Options</h3>

            <div className="field-row">
              <div className="field-group">
                <label className="field-label">Transport</label>
                <select
                  name="transport"
                  value={settings.transport || 'udp'}
                  onChange={handleChange}
                  disabled={registrationStatus === 'Registered'}
                  className="field-input"
                >
                  <option value="udp">UDP (native)</option>
                  <option value="ws">WS (WebRTC)</option>
                  <option value="wss">WSS (secure WebRTC)</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">WS Port</label>
                <input
                  type="text"
                  name="ws_servers_port"
                  value={settings.ws_servers_port}
                  onChange={handleChange}
                  disabled={registrationStatus === 'Registered' || !usingWebRTC}
                  className="field-input"
                />
              </div>
            </div>

            <div className="field-group">
              <label className="field-label">WS Host</label>
              <input
                type="text"
                name="ws_servers_host"
                value={settings.ws_servers_host}
                onChange={handleChange}
                disabled={registrationStatus === 'Registered' || !usingWebRTC}
                className="field-input"
              />
            </div>

            <div className="field-group">
              <label className="field-label field-label-row">
                Show Debug tab
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={Boolean(settings.show_debug_tab)}
                  onChange={(e) => setSettings({ show_debug_tab: e.target.checked })}
                />
              </label>
            </div>

            <div className="field-group">
              <label className="field-label field-label-row">
                Do not disturb
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={Boolean(settings.do_not_disturb)}
                  onChange={(e) => setSettings({ do_not_disturb: e.target.checked })}
                />
              </label>
            </div>

            <div className="field-group">
              <label className="field-label field-label-row">
                Hyper compact mode
                <input
                  type="checkbox"
                  className="toggle-checkbox"
                  checked={Boolean(settings.hyper_compact_mode)}
                  onChange={(e) => handleCompactModeToggle(e.target.checked)}
                />
              </label>
            </div>

            {!usingWebRTC && (
              <>
                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">Local SIP port</label>
                    <input
                      type="text"
                      name="local_sip_port"
                      value={settings.local_sip_port || '5061'}
                      onChange={handleChange}
                      disabled={registrationStatus === 'Registered'}
                      className="field-input"
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">STUN server (optional)</label>
                    <input
                      type="text"
                      name="stun_server"
                      value={settings.stun_server || ''}
                      onChange={handleChange}
                      disabled={registrationStatus === 'Registered'}
                      className="field-input"
                    />
                  </div>
                </div>

                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">RTP start port</label>
                    <input
                      type="text"
                      name="rtp_port_start"
                      value={settings.rtp_port_start || '4000'}
                      onChange={handleChange}
                      disabled={registrationStatus === 'Registered'}
                      className="field-input"
                    />
                  </div>
                  <div className="field-group">
                    <label className="field-label">RTP end port</label>
                    <input
                      type="text"
                      name="rtp_port_end"
                      value={settings.rtp_port_end || '4999'}
                      onChange={handleChange}
                      disabled={registrationStatus === 'Registered'}
                      className="field-input"
                    />
                  </div>
                </div>

                <div className="panel-card panel-card-subtle" style={{ marginTop: 8 }}>
                  <h3 className="panel-title"><Cpu size={16} style={{ verticalAlign: 'middle' }} /> UDP Engine Diagnostics</h3>
                  <div className="meta-grid settings-meta-grid">
                    <div className="meta-tile">
                      <div className="meta-label">Engine</div>
                      <div className="meta-value">{engineStatus}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                      <button type="button" className="secondary-btn" onClick={checkEngine}>
                        Check engine
                      </button>
                    </div>
                  </div>
                </div>

                <div className="panel-card panel-card-subtle" style={{ marginTop: 8 }}>
                  <h3 className="panel-title">Updates</h3>
                  <button type="button" className="secondary-btn" onClick={checkUpdates} disabled={checkingUpdate}>
                    {checkingUpdate ? 'Checking...' : 'Check for updates'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="info-box">
            <AlertTriangle size={16} />
            <span>
              {usingWebRTC
                ? 'For voice to work, your Asterisk must expose a WebRTC endpoint (PJSIP + WS/WSS + DTLS-SRTP + ICE/STUN).'
                : 'In native UDP mode, sip-agent.exe must be present to enable real audio; otherwise the app falls back to legacy signaling mode.'}
            </span>
          </div>
        </>
      )}

      {registrationStatus !== 'Registered' ? (
        <button onClick={handleConnect} type="button" className="primary-btn">
          {connectionStatus === 'Connecting' ? 'Connecting...' : 'Connect'}
        </button>
      ) : (
        <button onClick={disconnect} type="button" className="danger-btn">
          Disconnect
        </button>
      )}
    </div>
  );
};

export default Settings;
