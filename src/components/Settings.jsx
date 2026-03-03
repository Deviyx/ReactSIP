import React, { useEffect, useState } from 'react';
import { Settings as SettingsIcon, Copy, Check, Info, Mic, Speaker, Volume2, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';
import { useSIP } from '../hooks/useSIP';
import { useAudio } from '../hooks/useAudio';

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
  const [engineStatus, setEngineStatus] = useState('desconhecido');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (settings.audio_input_volume != null) {
      setInputVolume(settings.audio_input_volume);
    }
    if (settings.audio_output_volume != null) {
      setOutputVolume(settings.audio_output_volume);
    }
    if (settings.audio_output_device_id) {
      selectOutputDevice(settings.audio_output_device_id).catch(() => {});
    }
  }, [settings.audio_input_volume, settings.audio_output_volume, settings.audio_output_device_id, setInputVolume, setOutputVolume, selectOutputDevice]);

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
      alert('Preencha usuário, senha e domínio.');
      return;
    }
    connect();
  };

  const sipUri = `sip:${settings.username}@${settings.domain}`;
  const usingWebRTC = (settings.transport || 'udp').toLowerCase() !== 'udp';

  const checkEngine = async () => {
    if (!window.electronAPI?.sip?.pingEngine) return;
    const result = await window.electronAPI.sip.pingEngine();
    if (result?.success) {
      setEngineStatus(result.engine === 'native' ? 'nativo ativo' : 'legado/fallback');
    } else {
      setEngineStatus(`erro: ${result?.error || 'indisponível'}`);
    }
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sipUri);
    setCopiedSipUri(true);
    setTimeout(() => setCopiedSipUri(false), 1200);
  };

  return (
    <div className="surface-card page-scroll settings-root">
      <div className="section-title-row">
        <SettingsIcon size={20} className="accent-icon" />
        <h2 className="section-title">Configurações</h2>
      </div>

      <div className="panel-card">
        <div className="meta-grid">
          <div>
            <div className="meta-label">Status</div>
            <div className="meta-value">{registrationStatus}</div>
          </div>
          <div>
            <div className="meta-label">Conexão</div>
            <div className="meta-value">{connectionStatus}</div>
          </div>
        </div>

        {settings.username && settings.domain && (
          <div className="field-group">
            <div className="meta-label">SIP URI</div>
            <div className="sip-box">
              <code className="sip-code">{sipUri}</code>
              <button onClick={copyToClipboard} className="icon-btn" type="button" title="Copiar SIP URI">
                {copiedSipUri ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="panel-card">
        <h3 className="panel-title">Conta SIP</h3>

        <div className="field-group">
          <label className="field-label">Nome de exibição</label>
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
            <label className="field-label">Usuário</label>
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
            <label className="field-label">Senha</label>
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
          <label className="field-label">Domínio/IP</label>
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

      <div className="panel-card">
        <button
          type="button"
          className="secondary-btn advanced-toggle"
          onClick={() => setAdvancedOpen((prev) => !prev)}
        >
          <span>Avançado</span>
          {advancedOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>

        {advancedOpen && (
          <div className="advanced-content">
            <div className="field-row">
              <div className="field-group">
                <label className="field-label">Transporte</label>
                <select
                  name="transport"
                  value={settings.transport || 'udp'}
                  onChange={handleChange}
                  disabled={registrationStatus === 'Registered'}
                  className="field-input"
                >
                  <option value="udp">UDP (nativo)</option>
                  <option value="ws">WS (WebRTC)</option>
                  <option value="wss">WSS (WebRTC seguro)</option>
                </select>
              </div>
              <div className="field-group">
                <label className="field-label">WS Porta</label>
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
              <label className="field-label">WS Host (ex: 131.161.44.247 ou 131.161.44.247:8089/ws)</label>
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
              <label className="field-label" style={{ justifyContent: 'space-between' }}>
                Mostrar aba Debug
                <input
                  type="checkbox"
                  checked={Boolean(settings.show_debug_tab)}
                  onChange={(e) => setSettings({ show_debug_tab: e.target.checked })}
                />
              </label>
            </div>

            {!usingWebRTC && (
              <>
                <div className="field-row">
                  <div className="field-group">
                    <label className="field-label">Porta SIP local</label>
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
                    <label className="field-label">Servidor STUN (opcional)</label>
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
                    <label className="field-label">RTP porta inicial</label>
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
                    <label className="field-label">RTP porta final</label>
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

                <div className="panel-card" style={{ marginTop: 8 }}>
                  <h3 className="panel-title">Diagnóstico do motor UDP</h3>
                  <div className="meta-grid">
                    <div>
                      <div className="meta-label">Engine</div>
                      <div className="meta-value">{engineStatus}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'end' }}>
                      <button type="button" className="secondary-btn" onClick={checkEngine}>
                        Verificar engine
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="info-box">
        <Info size={16} />
        <span>
          {usingWebRTC
            ? 'Modo WebRTC ativo: requer SIP via WS/WSS para ter áudio bidirecional real.'
            : 'Modo UDP nativo: usa sidecar SIP/RTP para áudio bidirecional (com fallback legado).'}
        </span>
      </div>

      <div className="panel-card">
        <h3 className="panel-title">Áudio (dispositivos e volume)</h3>

        <div className="field-group">
          <label className="field-label"><Mic size={14} /> Entrada (microfone)</label>
          <select
            className="field-input"
            value={settings.audio_input_device_id || selectedInputDeviceId || 'default'}
            onChange={(e) => handleSelectInput(e.target.value)}
          >
            <option value="default">Padrão do sistema</option>
            {inputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microfone ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label"><Speaker size={14} /> Saída (alto-falante)</label>
          <select
            className="field-input"
            value={settings.audio_output_device_id || selectedOutputDeviceId || 'default'}
            onChange={(e) => handleSelectOutput(e.target.value)}
          >
            <option value="default">Padrão do sistema</option>
            {outputDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Saída ${device.deviceId.slice(0, 6)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">Volume de entrada: {Math.round(settings.audio_input_volume ?? inputVolume)}%</label>
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
          <label className="field-label">Volume de saída: {Math.round(settings.audio_output_volume ?? outputVolume)}%</label>
          <input
            type="range"
            min="0"
            max="150"
            value={settings.audio_output_volume ?? outputVolume}
            onChange={(e) => handleOutputVolume(e.target.value)}
            className="field-range"
          />
        </div>

        <div className="field-row">
          <button type="button" className="secondary-btn" onClick={playOutputTestTone}>
            <Volume2 size={14} />
            Testar saída
          </button>
          {isMonitoringInput ? (
            <button type="button" className="secondary-btn" onClick={stopInputMonitoring}>
              Parar retorno do microfone
            </button>
          ) : (
            <button type="button" className="secondary-btn" onClick={startInputMonitoring}>
              Ouvir meu microfone
            </button>
          )}
        </div>

        {micPermission === false && (
          <div className="info-box" style={{ marginTop: 10 }}>
            <AlertTriangle size={16} />
            <span>Sem permissão de microfone. Clique para habilitar.</span>
            <button type="button" className="icon-btn" onClick={() => requestMicrophone().catch(() => {})} title="Tentar novamente">
              <Mic size={14} />
            </button>
            <button
              type="button"
              className="secondary-btn"
              style={{ minHeight: 32, width: 'auto', padding: '0 10px' }}
              onClick={() => window.electronAPI?.app?.openMicrophonePrivacySettings?.()}
            >
              Abrir privacidade
            </button>
          </div>
        )}
      </div>

      <div className="info-box">
        <AlertTriangle size={16} />
        <span>
          {usingWebRTC
            ? 'Para funcionar com voz, seu Asterisk precisa de endpoint WebRTC (PJSIP + WS/WSS + DTLS-SRTP + ICE/STUN).'
            : 'Em UDP nativo, o sidecar sip-agent.exe precisa estar presente para ativar áudio real; sem ele o app entra em fallback legado.'}
        </span>
      </div>

      {registrationStatus !== 'Registered' ? (
        <button onClick={handleConnect} type="button" className="primary-btn">
          {connectionStatus === 'Connecting' ? 'Conectando...' : 'Conectar'}
        </button>
      ) : (
        <button onClick={disconnect} type="button" className="danger-btn">
          Desconectar
        </button>
      )}
    </div>
  );
};

export default Settings;
