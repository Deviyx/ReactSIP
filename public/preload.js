const { contextBridge, ipcRenderer } = require('electron');

// Expõe API segura para o React frontend
contextBridge.exposeInMainWorld('electronAPI', {
  app: {
    openMicrophonePrivacySettings: () => ipcRenderer.invoke('app:open-microphone-privacy-settings'),
    checkForUpdates: () => ipcRenderer.invoke('app:check-for-updates'),
    installUpdateNow: () => ipcRenderer.invoke('app:install-update-now'),
    minimizeWindow: () => ipcRenderer.invoke('app:window-minimize'),
    toggleMaximizeWindow: () => ipcRenderer.invoke('app:window-toggle-maximize'),
    closeWindow: () => ipcRenderer.invoke('app:window-close'),
    setHyperCompactMode: (enabled) => ipcRenderer.invoke('app:set-hyper-compact-mode', !!enabled),
  },

  // SIP operations
  sip: {
    connect: (settings) => ipcRenderer.invoke('sip:connect', settings),
    disconnect: () => ipcRenderer.invoke('sip:disconnect'),
    call: (number) => ipcRenderer.invoke('sip:call', number),
    transfer: (callId, target) => ipcRenderer.invoke('sip:transfer', callId, target),
    hangup: (callId) => ipcRenderer.invoke('sip:hangup', callId),
    accept: (callId) => ipcRenderer.invoke('sip:accept', callId),
    reject: (callId) => ipcRenderer.invoke('sip:reject', callId),
    mute: (callId, enabled) => ipcRenderer.invoke('sip:mute', callId, enabled),
    hold: (callId, enabled) => ipcRenderer.invoke('sip:hold', callId, enabled),
    sendDTMF: (callId, digits) => ipcRenderer.invoke('sip:send-dtmf', callId, digits),
    listAudioDevices: () => ipcRenderer.invoke('sip:list-audio-devices'),
    setAudioInputDevice: (deviceId) => ipcRenderer.invoke('sip:set-audio-input-device', deviceId),
    setAudioOutputDevice: (deviceId) => ipcRenderer.invoke('sip:set-audio-output-device', deviceId),
    setInputVolume: (percent) => ipcRenderer.invoke('sip:set-input-volume', percent),
    setOutputVolume: (percent) => ipcRenderer.invoke('sip:set-output-volume', percent),
    pingEngine: () => ipcRenderer.invoke('sip:ping-engine'),
    registerEventListener: () => ipcRenderer.send('sip:register-event-listener'),
  },

  // Event listeners
  onSipEvent: (callback) => {
    ipcRenderer.on('sip:event', (event, data) => callback(data));
  },

  onConnectionStatus: (callback) => {
    ipcRenderer.on('sip:connection-status', (event, status) => callback(status));
  },

  onRegistrationStatus: (callback) => {
    ipcRenderer.on('sip:registration-status', (event, status) => callback(status));
  },

  onIncomingCall: (callback) => {
    ipcRenderer.on('sip:incoming-call', (event, call) => callback(call));
  },

  onCallStateChange: (callback) => {
    ipcRenderer.on('sip:call-state-change', (event, state) => callback(state));
  },
  
  onCallNotification: (callback) => {
    ipcRenderer.on('sip:call-notification', (event, payload) => callback(payload));
  },

  onAudioDevices: (callback) => {
    ipcRenderer.on('sip:audio-devices', (event, payload) => callback(payload));
  },

  onAudioLevel: (callback) => {
    ipcRenderer.on('sip:audio-level', (event, payload) => callback(payload));
  },

  onEngineError: (callback) => {
    ipcRenderer.on('sip:engine-error', (event, payload) => callback(payload));
  },

  onUpdateStatus: (callback) => {
    ipcRenderer.on('app:update-status', (event, payload) => callback(payload));
  },

  onWindowState: (callback) => {
    ipcRenderer.on('app:window-state', (event, payload) => callback(payload));
  },

  // Cleanup listeners
  removeAllListeners: () => {
    ipcRenderer.removeAllListeners('sip:connection-status');
    ipcRenderer.removeAllListeners('sip:registration-status');
    ipcRenderer.removeAllListeners('sip:incoming-call');
    ipcRenderer.removeAllListeners('sip:call-state-change');
    ipcRenderer.removeAllListeners('sip:call-notification');
    ipcRenderer.removeAllListeners('sip:audio-devices');
    ipcRenderer.removeAllListeners('sip:audio-level');
    ipcRenderer.removeAllListeners('sip:engine-error');
    ipcRenderer.removeAllListeners('sip:event');
    ipcRenderer.removeAllListeners('app:update-status');
    ipcRenderer.removeAllListeners('app:window-state');
  },
});
