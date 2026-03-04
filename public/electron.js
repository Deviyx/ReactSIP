const { app, BrowserWindow, ipcMain, session, shell } = require('electron');
const path = require('path');
const https = require('https');
const dgram = require('dgram');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const readline = require('readline');
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (error) {
  console.warn('[updater] electron-updater not available, updater disabled:', error.message);
}
const DEV_SERVER_URL = process.env.ELECTRON_RENDERER_URL || process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

// Detectar se está em desenvolvimento
const isDev = !app.isPackaged;

let mainWindow;
let transcriptionWindow = null;
let sipClient = null;
let nativeSipBridge = null;
let transcriptionBridge = null;
let currentSettings = null;
let preferNativeEngine = process.env.SIP_ENGINE === 'native';
let updateCheckTimer = null;

const ENGINE_READY_TIMEOUT_MS = 6000;
const UPDATE_CHECK_INTERVAL_MS = 1000 * 60 * 60 * 4;
const WINDOW_NORMAL = { width: 360, height: 700, minWidth: 340, minHeight: 620 };
const WINDOW_COMPACT = { width: 320, height: 600, minWidth: 300, minHeight: 520 };
const WHISPER_RUNTIME_ASSET = process.env.WHISPER_RUNTIME_ASSET || 'whisper-runtime-win-x64.zip';
const WHISPER_RUNTIME_URL = process.env.WHISPER_RUNTIME_URL || `https://github.com/Deviyx/ReactSIP/releases/latest/download/${WHISPER_RUNTIME_ASSET}`;
const WHISPER_RUNTIME_REPO = process.env.WHISPER_RUNTIME_REPO || 'Deviyx/ReactSIP';
const WHISPER_RUNTIME_DIRNAME = 'whisper-runtime';
const WHISPER_RUNTIME_SCHEMA_VERSION = process.env.WHISPER_RUNTIME_SCHEMA_VERSION || '2';

function configureMediaPermissions() {
  const ses = session.defaultSession;
  if (!ses) return;

  ses.setPermissionCheckHandler((_webContents, permission) => {
    if (permission === 'media' || permission === 'microphone') return true;
    return false;
  });

  ses.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    if (permission === 'media') {
      const wantsAudio = Array.isArray(details?.mediaTypes) ? details.mediaTypes.includes('audio') : true;
      callback(wantsAudio);
      return;
    }
    if (permission === 'microphone') {
      callback(true);
      return;
    }
    callback(false);
  });
}

function emitRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function emitAllWindows(channel, payload) {
  BrowserWindow.getAllWindows().forEach((win) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.send(channel, payload);
  });
}

function emitUpdateStatus(payload) {
  emitRenderer('app:update-status', payload);
}

function emitTranscriptionStatus(state, payload = {}) {
  emitAllWindows('transcription:event', { type: state, payload });
}

function getWhisperRuntimeDir() {
  return path.join(app.getPath('userData'), WHISPER_RUNTIME_DIRNAME);
}

function getWhisperRuntimeWorkerPath() {
  return path.join(getWhisperRuntimeDir(), 'faster-whisper-worker.exe');
}

function getWhisperRuntimeMarkerPath() {
  return path.join(getWhisperRuntimeDir(), '.reactsip-runtime-version');
}

function readWhisperRuntimeMarker() {
  const markerPath = getWhisperRuntimeMarkerPath();
  if (!fs.existsSync(markerPath)) return null;
  try {
    return String(fs.readFileSync(markerPath, 'utf8') || '').trim();
  } catch {
    return null;
  }
}

function writeWhisperRuntimeMarker() {
  const markerPath = getWhisperRuntimeMarkerPath();
  fs.writeFileSync(markerPath, `${WHISPER_RUNTIME_SCHEMA_VERSION}\n`, 'utf8');
}

function downloadFile(url, destination, onProgress) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        const redirect = response.headers.location.startsWith('http')
          ? response.headers.location
          : new URL(response.headers.location, url).toString();
        response.resume();
        downloadFile(redirect, destination, onProgress).then(resolve).catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Runtime download failed (${response.statusCode})`));
        return;
      }

      const total = Number(response.headers['content-length'] || 0);
      let transferred = 0;
      const file = fs.createWriteStream(destination);

      response.on('data', (chunk) => {
        transferred += chunk.length;
        if (typeof onProgress === 'function') {
          const percent = total > 0 ? (transferred / total) * 100 : 0;
          onProgress({ transferred, total, percent });
        }
      });

      response.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
      file.on('error', (err) => reject(err));
    });

    request.on('error', reject);
  });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'ReactSIP-Updater',
        Accept: 'application/vnd.github+json',
      },
    }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub API request failed (${response.statusCode})`));
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(new Error(`Invalid JSON response from ${url}: ${error.message}`));
        }
      });
    });

    req.on('error', reject);
  });
}

async function resolveWhisperRuntimeUrl() {
  if (process.env.WHISPER_RUNTIME_URL) {
    return process.env.WHISPER_RUNTIME_URL;
  }

  const [owner, repo] = WHISPER_RUNTIME_REPO.split('/');
  if (!owner || !repo) return WHISPER_RUNTIME_URL;

  // Fallback: find the newest release (stable or prerelease) that actually has the runtime asset.
  try {
    const releases = await fetchJson(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=30`);
    if (Array.isArray(releases)) {
      for (const rel of releases) {
        const assets = Array.isArray(rel.assets) ? rel.assets : [];
        const asset = assets.find((item) => item && item.name === WHISPER_RUNTIME_ASSET && item.browser_download_url);
        if (asset) {
          return asset.browser_download_url;
        }
      }
    }
  } catch (error) {
    console.warn('[whisper] failed to resolve runtime URL from releases list:', error.message);
  }

  return WHISPER_RUNTIME_URL;
}

function extractZipWindows(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-Command',
      `Expand-Archive -Path "${zipPath.replace(/"/g, '""')}" -DestinationPath "${destDir.replace(/"/g, '""')}" -Force`,
    ], { windowsHide: true });

    let stderr = '';
    ps.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    ps.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Expand-Archive failed with code ${code}`));
    });
  });
}

async function ensureWhisperRuntime(forceDownload = false) {
  const workerPath = getWhisperRuntimeWorkerPath();
  const runtimeVersion = readWhisperRuntimeMarker();
  const hasValidMarker = runtimeVersion === WHISPER_RUNTIME_SCHEMA_VERSION;
  if (!forceDownload && fs.existsSync(workerPath) && hasValidMarker) {
    return { success: true, installed: true, workerPath };
  }

  if (!forceDownload && fs.existsSync(workerPath) && !hasValidMarker) {
    forceDownload = true;
  }

  const runtimeDir = getWhisperRuntimeDir();
  if (forceDownload && fs.existsSync(runtimeDir)) {
    try {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; continue with overwrite flow.
    }
  }
  fs.mkdirSync(runtimeDir, { recursive: true });
  const zipPath = path.join(runtimeDir, WHISPER_RUNTIME_ASSET);

  try {
    const runtimeUrl = await resolveWhisperRuntimeUrl();
    emitTranscriptionStatus('runtime_installing', { message: 'Installing transcription runtime...', url: runtimeUrl });
    await downloadFile(runtimeUrl, zipPath, (progress) => {
      emitTranscriptionStatus('runtime_download_progress', progress);
    });
    emitTranscriptionStatus('runtime_extracting', { message: 'Extracting transcription runtime...' });
    await extractZipWindows(zipPath, runtimeDir);
  } finally {
    if (fs.existsSync(zipPath)) {
      try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
    }
  }

  if (!fs.existsSync(workerPath)) {
    throw new Error(`Runtime installed but worker not found: ${workerPath}`);
  }
  writeWhisperRuntimeMarker();
  emitTranscriptionStatus('runtime_ready', { workerPath });
  return { success: true, installed: true, workerPath };
}

function checkForUpdatesInBackground() {
  if (isDev || !app.isPackaged || !autoUpdater) return;
  autoUpdater.checkForUpdates().catch((error) => {
    console.warn('[updater] check failed:', error.message);
    emitUpdateStatus({
      state: 'error',
      message: `Falha ao verificar atualizacoes: ${error.message}`,
    });
  });
}

function setupAutoUpdater() {
  if (isDev || !app.isPackaged || !autoUpdater) {
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => {
    emitUpdateStatus({ state: 'checking', message: 'Verificando atualizacoes...' });
  });

  autoUpdater.on('update-available', (info) => {
    emitUpdateStatus({
      state: 'available',
      version: info?.version,
      message: `Atualizacao ${info?.version || ''} encontrada. Baixando...`.trim(),
    });
  });

  autoUpdater.on('update-not-available', () => {
    emitUpdateStatus({ state: 'not-available', message: 'Aplicativo ja esta atualizado.' });
  });

  autoUpdater.on('download-progress', (progress) => {
    emitUpdateStatus({
      state: 'downloading',
      percent: Number(progress?.percent || 0),
      bytesPerSecond: Number(progress?.bytesPerSecond || 0),
      transferred: Number(progress?.transferred || 0),
      total: Number(progress?.total || 0),
      message: 'Baixando atualizacao...',
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    emitUpdateStatus({
      state: 'downloaded',
      version: info?.version,
      message: `Atualizacao ${info?.version || ''} pronta. Reiniciando para aplicar...`.trim(),
    });

    // Match native desktop behavior: apply update immediately after download.
    setTimeout(() => {
      try {
        autoUpdater.quitAndInstall(false, true);
      } catch (error) {
        emitUpdateStatus({
          state: 'error',
          message: `Falha ao reiniciar para atualizar: ${error?.message || 'desconhecido'}`,
        });
      }
    }, 1500);
  });

  autoUpdater.on('error', (error) => {
    emitUpdateStatus({
      state: 'error',
      message: `Erro no updater: ${error?.message || 'desconhecido'}`,
    });
  });

  setTimeout(checkForUpdatesInBackground, 6000);
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
  }
  updateCheckTimer = setInterval(checkForUpdatesInBackground, UPDATE_CHECK_INTERVAL_MS);
}

class NativeSipBridge {
  constructor() {
    this.proc = null;
    this.rl = null;
    this.pending = new Map();
    this.reqCounter = 0;
    this.ready = false;
    this.starting = false;
    this.enginePath = this.resolveEnginePath();
  }

  resolveEnginePath() {
    const exeName = 'sip-agent.exe';
    const candidates = [];

    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'native', exeName));
    } else {
      candidates.push(path.join(app.getAppPath(), 'native', 'sip-agent', 'build-pjsip', 'Release', exeName));
      candidates.push(path.join(app.getAppPath(), 'native', 'sip-agent', 'build', 'Release', exeName));
      candidates.push(path.join(app.getAppPath(), 'native', 'sip-agent', 'build', exeName));
      candidates.push(path.join(app.getAppPath(), 'native', 'sip-agent', 'bin', exeName));
    }

    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  }

  exists() {
    return fs.existsSync(this.enginePath);
  }

  async start() {
    if (this.ready) return;
    if (this.starting) return;

    if (!this.exists()) {
      throw new Error(`Native SIP engine not found at ${this.enginePath}`);
    }

    this.starting = true;
    this.proc = spawn(this.enginePath, [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc.on('exit', (code, signal) => {
      console.error(`[native-sip] exited code=${code} signal=${signal}`);
      this.ready = false;
      this.starting = false;
      this.rejectAllPending(new Error('Native SIP engine exited'));
      emitRenderer('sip:engine-error', {
        code: 'ENGINE_EXIT',
        message: `Native SIP engine exited (${code || signal || 'unknown'})`,
      });
    });

    this.proc.stderr.on('data', (chunk) => {
      const line = String(chunk).trim();
      if (!line) return;
      console.log(`[native-sip][stderr] ${line}`);
      emitRenderer('sip:event', { type: 'engine_stderr', line });
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => this.handleLine(line));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Native SIP engine startup timeout'));
      }, ENGINE_READY_TIMEOUT_MS);

      const onReady = () => {
        clearTimeout(timeout);
        this.offReady = null;
        resolve();
      };

      this.offReady = onReady;
    });

    this.starting = false;
  }

  stop() {
    this.ready = false;
    this.starting = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.rejectAllPending(new Error('Native SIP engine stopped'));
  }

  rejectAllPending(err) {
    this.pending.forEach(({ reject }) => reject(err));
    this.pending.clear();
  }

  handleLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    if (!trimmed.startsWith('{')) {
      emitRenderer('sip:event', { type: 'engine_log', line: trimmed });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(trimmed);
    } catch (error) {
      emitRenderer('sip:event', { type: 'engine_log', line: trimmed });
      return;
    }

    if (msg.type === 'event') {
      this.handleEvent(msg.event, msg.payload || {});
      return;
    }

    if (msg.type === 'response' && msg.requestId) {
      const entry = this.pending.get(msg.requestId);
      if (entry) {
        this.pending.delete(msg.requestId);
        if (msg.ok) entry.resolve(msg.payload || {});
        else entry.reject(new Error(msg.error || 'Native SIP engine command failed'));
      }
      return;
    }
  }

  handleEvent(eventName, payload) {
    emitRenderer('sip:event', { type: eventName, payload });

    if (eventName === 'engine_ready') {
      this.ready = true;
      if (typeof this.offReady === 'function') this.offReady();
      return;
    }

    if (eventName === 'registration_state') {
      const stateMap = {
        registered: 'Registered',
        registering: 'Registering',
        unregistered: 'Unregistered',
        failed: 'Registration Failed',
      };
      emitRenderer('sip:registration-status', stateMap[payload.state] || payload.state || 'Unknown');
      if (payload.state === 'registered') emitRenderer('sip:connection-status', 'Connected');
      if (payload.state === 'failed') emitRenderer('sip:connection-status', 'Disconnected');
      return;
    }

    if (eventName === 'incoming_call') {
      emitRenderer('sip:incoming-call', {
        id: payload.callId,
        number: payload.number || 'unknown',
        displayName: payload.displayName || payload.number || 'unknown',
      });
      return;
    }

    if (eventName === 'call_state') {
      emitRenderer('sip:call-state-change', {
        id: payload.callId,
        state: payload.state,
        sipCode: payload.sipCode,
        reason: payload.reason,
      });
      return;
    }

    if (eventName === 'call_media_state') {
      emitRenderer('sip:event', { type: 'call_media_state', payload });
      return;
    }

    if (eventName === 'audio_devices') {
      emitRenderer('sip:audio-devices', payload);
      return;
    }

    if (eventName === 'audio_level') {
      emitRenderer('sip:audio-level', payload);
      return;
    }

    if (eventName === 'error') {
      emitRenderer('sip:engine-error', payload);
    }
  }

  sendCommand(command, payload = {}) {
    if (!this.proc || !this.proc.stdin || this.proc.killed) {
      return Promise.reject(new Error('Native SIP engine is not running'));
    }
    const requestId = `req_${++this.reqCounter}`;
    const packet = { type: 'command', requestId, command, payload };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify(packet)}\n`, (err) => {
        if (err) {
          this.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  async connect(settings) {
    await this.start();
    return this.sendCommand('connect', {
      username: settings.username,
      password: settings.password,
      domain: settings.domain,
      displayName: settings.display_name || settings.username,
      localSipPort: Number(settings.local_sip_port || 5061),
      rtpPortStart: Number(settings.rtp_port_start || 4000),
      rtpPortEnd: Number(settings.rtp_port_end || 4999),
      stunServer: settings.stun_server || '',
    });
  }

  disconnect() {
    return this.sendCommand('disconnect');
  }

  makeCall(target) {
    return this.sendCommand('make_call', { target });
  }

  answer(callId) {
    return this.sendCommand('answer', { callId });
  }

  reject(callId) {
    return this.sendCommand('reject', { callId });
  }

  hangup(callId) {
    return this.sendCommand('hangup', { callId });
  }

  transfer(callId, target) {
    return this.sendCommand('transfer', { callId, target });
  }

  mute(callId, enabled) {
    return this.sendCommand('mute', { callId, enabled: !!enabled });
  }

  hold(callId, enabled) {
    return this.sendCommand('hold', { callId, enabled: !!enabled });
  }

  sendDTMF(callId, digits) {
    return this.sendCommand('send_dtmf', { callId, digits });
  }

  listAudioDevices() {
    return this.sendCommand('list_audio_devices');
  }

  setAudioInputDevice(deviceId) {
    return this.sendCommand('set_audio_input_device', { deviceId });
  }

  setAudioOutputDevice(deviceId) {
    return this.sendCommand('set_audio_output_device', { deviceId });
  }

  setInputVolume(percent) {
    return this.sendCommand('set_input_volume', { percent: Number(percent) });
  }

  setOutputVolume(percent) {
    return this.sendCommand('set_output_volume', { percent: Number(percent) });
  }

  ping() {
    return this.sendCommand('ping');
  }
}

class WhisperTranscriptionBridge {
  constructor() {
    this.proc = null;
    this.rl = null;
    this.pending = new Map();
    this.reqCounter = 0;
    this.ready = false;
    this.starting = false;
    this.launch = this.resolveLaunch();
  }

  resolveScriptPath() {
    const candidates = [];
    if (app.isPackaged) {
      candidates.push(path.join(process.resourcesPath, 'scripts', 'faster_whisper_worker.py'));
    }
    candidates.push(path.join(app.getAppPath(), 'scripts', 'faster_whisper_worker.py'));
    candidates.push(path.join(process.cwd(), 'scripts', 'faster_whisper_worker.py'));
    return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  }

  resolvePythonLaunch() {
    const candidates = [
      { cmd: 'py', args: ['-3'] },
      { cmd: 'python', args: [] },
      { cmd: 'python3', args: [] },
    ];
    for (const candidate of candidates) {
      try {
        const probe = spawnSync(candidate.cmd, [...candidate.args, '--version'], {
          encoding: 'utf8',
          windowsHide: true,
        });
        if (probe && probe.status === 0) return candidate;
      } catch {
        // probe failed
      }
    }
    return null;
  }

  resolveLaunch() {
    const runtimeExe = getWhisperRuntimeWorkerPath();
    if (fs.existsSync(runtimeExe)) {
      return { cmd: runtimeExe, args: [], mode: 'runtime-exe' };
    }

    const scriptPath = this.resolveScriptPath();
    const py = this.resolvePythonLaunch();
    if (scriptPath && py) {
      return { cmd: py.cmd, args: [...py.args, scriptPath], mode: 'python-script', scriptPath };
    }
    return null;
  }

  refreshLaunch() {
    this.launch = this.resolveLaunch();
    return this.launch;
  }

  exists() {
    if (!this.launch) return false;
    if (this.launch.mode === 'runtime-exe') return fs.existsSync(this.launch.cmd);
    if (this.launch.mode === 'python-script') return fs.existsSync(this.launch.scriptPath || '');
    return false;
  }

  async start() {
    if (this.ready) return;
    if (this.starting) return;
    this.refreshLaunch();
    if (!this.exists()) {
      throw new Error('Whisper runtime is missing. Install runtime first.');
    }

    this.starting = true;
    this.proc = spawn(this.launch.cmd, this.launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.proc.on('exit', (code, signal) => {
      this.ready = false;
      this.starting = false;
      this.rejectAllPending(new Error('Whisper worker exited'));
      emitAllWindows('transcription:event', {
        type: 'error',
        payload: { message: `Whisper worker exited (${code || signal || 'unknown'})` },
      });
    });

    this.proc.stderr.on('data', (chunk) => {
      const line = String(chunk || '').trim();
      if (!line) return;
      emitAllWindows('transcription:event', {
        type: 'log',
        payload: { line },
      });
    });

    this.rl = readline.createInterface({ input: this.proc.stdout });
    this.rl.on('line', (line) => this.handleLine(line));

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Whisper startup timeout')), 8000);
      this.offReady = () => {
        clearTimeout(timeout);
        resolve();
      };
    });

    this.starting = false;
  }

  stop() {
    this.ready = false;
    this.starting = false;
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
    this.rejectAllPending(new Error('Whisper worker stopped'));
  }

  rejectAllPending(err) {
    this.pending.forEach(({ reject }) => reject(err));
    this.pending.clear();
  }

  handleLine(line) {
    const text = String(line || '').trim();
    if (!text) return;

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      emitAllWindows('transcription:event', {
        type: 'log',
        payload: { line: text },
      });
      return;
    }

    if (msg.type === 'event') {
      if (msg.event === 'engine_ready') {
        this.ready = true;
        if (typeof this.offReady === 'function') this.offReady();
      }
      emitAllWindows('transcription:event', {
        type: msg.event,
        payload: msg.payload || {},
      });
      return;
    }

    if (msg.type === 'response' && msg.requestId) {
      const entry = this.pending.get(msg.requestId);
      if (!entry) return;
      this.pending.delete(msg.requestId);
      if (msg.ok) entry.resolve(msg.payload || {});
      else entry.reject(new Error(msg.error || 'Whisper command failed'));
    }
  }

  sendCommand(command, payload = {}) {
    if (!this.proc || !this.proc.stdin || this.proc.killed) {
      return Promise.reject(new Error('Whisper worker is not running.'));
    }
    const requestId = `wreq_${++this.reqCounter}`;
    const packet = { type: 'command', requestId, command, payload };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.proc.stdin.write(`${JSON.stringify(packet)}\n`, (err) => {
        if (err) {
          this.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  async startSession(options = {}) {
    await this.start();
    return this.sendCommand('start_session', options);
  }

  stopSession() {
    return this.sendCommand('stop_session');
  }

  transcribeChunk(chunk = {}) {
    return this.sendCommand('transcribe_chunk', chunk);
  }
}

function ensureTranscriptionBridge() {
  if (!transcriptionBridge) {
    transcriptionBridge = new WhisperTranscriptionBridge();
  }
  return transcriptionBridge;
}

function isUdpTransport(settings = {}) {
  const transport = String(settings.transport || 'udp').toLowerCase();
  return transport === 'udp';
}

function shouldUseNativeEngine(settings = {}) {
  if (!isUdpTransport(settings)) return false;
  if (process.platform !== 'win32') return false;

  if (preferNativeEngine) return true;
  if (nativeSipBridge && nativeSipBridge.exists()) return true;

  return false;
}

function ensureNativeBridge() {
  if (!nativeSipBridge) {
    nativeSipBridge = new NativeSipBridge();
  }
  return nativeSipBridge;
}

// ============ SIP Client Class ============
class SIPClient {
  constructor(settings) {
    this.username = settings.username;
    this.password = settings.password;
    this.domain = settings.domain;
    this.displayName = settings.display_name || settings.username;
    
    // Try to parse domain as server host (could be IP or hostname)
    this.serverHost = settings.domain;
    this.serverPort = 5060;
    
    // Get local IP
    this.localIP = this.getLocalIP();
    this.localPort = 5061; // Use a different port for client
    
    this.socket = null;
    this.registered = false;
    this.registrationTimeout = null;
    this.activeCalls = new Map();
    this.callCounter = 0;
    this.sequenceNumber = Math.floor(Math.random() * 9000) + 1000;
    this.authHeader = null;
    this.nonce = null;

    // authentication helpers to try different URI variants if one fails
    this.authUriCandidates = [
      `sip:${this.domain}:${this.serverPort}`,
      `sip:${this.domain}`
    ];
    this.authTryIndex = 0;
    
    console.log(`SIPClient created with:`);
    console.log(`  Domain/Host: ${this.serverHost}`);
    console.log(`  Port: ${this.serverPort}`);
    console.log(`  User: ${this.username}`);
  }

  getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return '127.0.0.1';
  }

  generateBranch() {
    return 'z9hG4bK' + crypto.randomBytes(8).toString('hex');
  }

  generateTag() {
    return crypto.randomBytes(8).toString('hex');
  }

  generateCallID() {
    return crypto.randomBytes(8).toString('hex') + '@' + this.localIP;
  }

  md5Hash(data) {
    return crypto.createHash('md5').update(data).digest('hex');
  }

  findCallEntryByCallID(callID) {
    for (const [key, call] of this.activeCalls.entries()) {
      if (call.callID === callID) {
        return { key, call };
      }
    }
    return null;
  }

  notifyCall(level, message, callId = null) {
    if (mainWindow) {
      mainWindow.webContents.send('sip:call-notification', { level, message, callId });
    }
  }

  extractHostPortFromSipUri(uri) {
    const match = uri ? uri.match(/^sip:(?:[^@]+@)?([^:;>]+)(?::(\d+))?/i) : null;
    return {
      host: match ? match[1] : this.serverHost,
      port: match && match[2] ? parseInt(match[2], 10) : this.serverPort,
    };
  }

  async connect() {
    return new Promise((resolve, reject) => {
      try {
        console.log(`\n=== SIP Connection Started ===`);
        console.log(`Target: ${this.serverHost}:${this.serverPort}`);
        console.log(`Local: ${this.localIP}:${this.localPort}`);
        console.log(`User: ${this.username}@${this.domain}\n`);
        
        this.socket = dgram.createSocket('udp4');
        
        this.socket.on('error', (err) => {
          console.error('❌ Socket error:', err.message);
          if (mainWindow) {
            mainWindow.webContents.send('sip:registration-status', `Connection Error: ${err.message}`);
          }
          reject(err);
        });

        this.socket.on('message', (msg, rinfo) => {
          console.log(`\n📨 Received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`);
          this.handleSIPMessage(msg.toString(), rinfo);
        });

        this.socket.on('timeout', () => {
          console.warn('⚠️ Socket timeout');
        });

        this.socket.bind(this.localPort, () => {
          console.log(`✓ Socket bound to ${this.localIP}:${this.localPort}`);
          if (mainWindow) {
            mainWindow.webContents.send('sip:connection-status', 'Connecting');
          }
          this.register();
        });

        // Timeout for registration - wait for actual 200 OK response
        this.registrationTimeout = setTimeout(() => {
          if (!this.registered) {
            console.error('✗ Registration timeout - no response from server');
            console.log('Possible causes:');
            console.log('  - Port 5060 is blocked/closed');
            console.log('  - Server IP is incorrect: ' + this.serverHost);
            console.log('  - Firewall blocking UDP');
            this.socket.close();
            if (mainWindow) {
              mainWindow.webContents.send('sip:registration-status', 'No Response - Check Server/Firewall');
            }
            reject(new Error('Registration timeout - no response from server'));
          }
        }, 10000);

        // Resolve only when registration succeeds
        this.onRegistrationComplete = () => {
          if (this.registrationTimeout) {
            clearTimeout(this.registrationTimeout);
          }
          resolve();
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  register() {
    const callID = this.generateCallID();
    const branch = this.generateBranch();
    const tag = this.generateTag();
    
    const via = `SIP/2.0/UDP ${this.localIP}:${this.localPort};branch=${branch}`;
    const from = `<sip:${this.username}@${this.domain}>;tag=${tag}`;
    const to = `<sip:${this.username}@${this.domain}>`;
    const contact = `<sip:${this.username}@${this.localIP}:${this.localPort}>`;
    
    // start with a default request URI (port included)
    const requestURI = `sip:${this.domain}:${this.serverPort}`;
    let message = `REGISTER ${requestURI} SIP/2.0\r\n`;
    message += `Via: ${via}\r\n`;
    message += `From: ${from}\r\n`;
    message += `To: ${to}\r\n`;
    message += `Call-ID: ${callID}\r\n`;
    message += `CSeq: ${this.sequenceNumber} REGISTER\r\n`;
    message += `Contact: ${contact}\r\n`;
    message += `Expires: 3600\r\n`;
    message += `Max-Forwards: 70\r\n`;
    message += `User-Agent: MicroSIP-Electron/1.0\r\n`;
    message += `Allow: INVITE, ACK, BYE, CANCEL, OPTIONS\r\n`;
    message += `Content-Length: 0\r\n`;
    message += `\r\n`;

    // save the values so the auth retry can reuse them
    this.pendingRegister = {
      callID,
      branch,
      tag,
      requestURI,
      via,
      from,
      to,
      contact
    };

    console.log(`Sending REGISTER to ${this.serverHost}:${this.serverPort} for ${this.username}@${this.domain}`);
    console.log('REGISTER message body:\n' + message);
    this.sequenceNumber++;
    this.sendSIPMessage(message);
  }

  sendSIPMessage(message, targetHost = this.serverHost, targetPort = this.serverPort) {
    const buffer = Buffer.from(message);
    console.log(`\n📤 Sending ${buffer.length} bytes to ${targetHost}:${targetPort}`);
    console.log('First line:', message.split('\r\n')[0]);
    if (message.includes('Authorization:')) {
      console.log('🔒 Authorization header present');
      // Optionally log the header itself for debugging
      const authLine = message.split('\r\n').find(l => l.startsWith('Authorization:'));
      console.log(authLine);
    }

    this.socket.send(
      buffer,
      targetPort,
      targetHost,
      (err) => {
        if (err) {
          console.error('❌ Send error:', err.message);
        } else {
          console.log('✓ Message sent successfully');
        }
      }
    );
  }

  handleSIPMessage(message, rinfo = null) {
    console.log('Received SIP message from server');
    const firstLine = (message.split('\r\n')[0] || '').trim();
    console.log('Response:', firstLine);

    const firstToken = firstLine.split(/\s+/)[0].toUpperCase();
    const isResponse = firstToken === 'SIP/2.0';
    const requestMethods = new Set(['INVITE', 'ACK', 'BYE', 'CANCEL', 'OPTIONS', 'NOTIFY', 'MESSAGE', 'INFO', 'SUBSCRIBE']);

    if (requestMethods.has(firstToken)) {
      if (firstToken === 'INVITE') {
        this.handleIncomingCall(message);
      } else if (firstToken === 'OPTIONS' || firstToken === 'NOTIFY') {
        this.handleIncomingRequest(message, rinfo);
      } else if (firstToken === 'BYE') {
        this.handleIncomingBye(message, rinfo);
      } else {
        console.log(`Ignoring unsupported incoming request: ${firstToken}`);
      }
      return;
    }

    if (!isResponse) {
      console.log('Unknown message type: ' + firstLine);
      return;
    }

    const statusMatch = firstLine.match(/SIP\/2\.0\s(\d+)/);
    const statusCode = statusMatch ? parseInt(statusMatch[1], 10) : null;
    const cseqMethodMatch = message.match(/^\s*CSeq:\s*\d+\s+([A-Z]+)\s*$/im);
    const cseqMethod = cseqMethodMatch ? cseqMethodMatch[1].toUpperCase() : null;
    const cidMatch = message.match(/Call-ID:\s*(\S+)/i);
    const callID = cidMatch ? cidMatch[1] : null;
    const found = callID ? this.findCallEntryByCallID(callID) : null;

    if (statusCode === 100 && cseqMethod === 'INVITE') return;

    if (statusCode === 200 && cseqMethod === 'REGISTER') {
      this.registered = true;
      if (this.registrationTimeout) clearTimeout(this.registrationTimeout);
      this.pendingRegister = null;
      if (mainWindow) {
        mainWindow.webContents.send('sip:registration-status', 'Registered');
        mainWindow.webContents.send('sip:connection-status', 'Connected');
      }
      if (this.onRegistrationComplete) {
        this.onRegistrationComplete();
        this.onRegistrationComplete = null;
      }
      return;
    }

    if (statusCode === 200 && cseqMethod === 'INVITE' && found) {
      const { key, call } = found;
      const toHeaderMatch = message.match(/^To:\s*(.+)$/im);
      const fromHeaderMatch = message.match(/^From:\s*(.+)$/im);
      const contactMatch = message.match(/^Contact:\s*(.+)$/im);
      if (toHeaderMatch) call.toHeader = toHeaderMatch[1].trim();
      if (fromHeaderMatch) call.fromHeader = fromHeaderMatch[1].trim();
      if (contactMatch) {
        const contactUriMatch = contactMatch[1].match(/<([^>]+)>/);
        if (contactUriMatch && contactUriMatch[1]) call.remoteTarget = contactUriMatch[1];
      }
      this.sendInviteAck(message, call);
      if (call.state !== 'connected') {
        call.state = 'connected';
        if (mainWindow) mainWindow.webContents.send('sip:call-state-change', { id: key, state: 'connected' });
      }
      return;
    }

    if ((statusCode === 200 || statusCode === 202) && cseqMethod === 'REFER') {
      this.notifyCall('success', 'Transferencia iniciada');
      return;
    }

    if ((statusCode === 180 || statusCode === 183) && found) {
      if (found.call.state !== 'ringing') {
        found.call.state = 'ringing';
        if (mainWindow) mainWindow.webContents.send('sip:call-state-change', { id: found.key, state: 'ringing' });
      }
      return;
    }

    if (statusCode === 401) {
      const methodMatch = message.match(/CSeq:\s*\d+\s+(\w+)/i);
      const method = methodMatch ? methodMatch[1].toUpperCase() : 'REGISTER';
      this.handleAuthChallenge(message, method, found ? found.call : null);
      return;
    }

    if (cseqMethod === 'INVITE') {
      const inviteErrorMap = {
        403: 'Chamada bloqueada',
        404: 'Numero nao existe',
        408: 'Sem resposta do destino',
        480: 'Destino indisponivel',
        481: 'Dialogo inexistente',
        486: 'Numero ocupado',
        487: 'Chamada cancelada',
        500: 'Erro interno do servidor',
        503: 'Servico indisponivel',
        603: 'Chamada recusada',
      };
      if (found) {
        found.call.state = [486, 487, 603].includes(statusCode) ? 'ended' : 'failed';
        if (mainWindow) {
          mainWindow.webContents.send('sip:call-state-change', { id: found.key, state: found.call.state });
        }
      }
      const errorMessage = inviteErrorMap[statusCode] || `Falha na chamada (${statusCode || 'desconhecido'})`;
      this.notifyCall('error', errorMessage, found ? found.key : null);
      return;
    }

    if (statusCode === 407 || statusCode === 403 || statusCode === 404) {
      if (mainWindow) {
        const statusText = statusCode === 407 ? 'Auth Failed' : statusCode === 403 ? 'Forbidden - Check Credentials' : 'User Not Found';
        mainWindow.webContents.send('sip:registration-status', statusText);
      }
      return;
    }

    if (cseqMethod === 'REFER' && [403, 404, 481, 500].includes(statusCode)) {
      this.notifyCall('error', `Falha na transferencia (${statusCode})`);
      return;
    }

    console.log('Other SIP response:', firstLine);
  }

  handleAuthChallenge(message, method = 'REGISTER', relatedCall = null) {
    const lines = message.split('\r\n');
    let wwwAuth = '';

    for (const line of lines) {
      if (line.toLowerCase().startsWith('www-authenticate')) {
        wwwAuth = line.substring(line.indexOf(':') + 1).trim();
        break;
      }
    }

    if (!wwwAuth) {
      console.error('No WWW-Authenticate header found');
      if (mainWindow) {
        mainWindow.webContents.send('sip:registration-status', 'Auth Failed');
      }
      return;
    }

    console.log('WWW-Authenticate challenge:', wwwAuth);

    // Parse auth parameters (realm, nonce, qop, algorithm)
    const realmMatch = wwwAuth.match(/realm="([^\"]+)"/);
    const nonceMatch = wwwAuth.match(/nonce="([^\"]+)"/);
    const qopMatch = wwwAuth.match(/qop="([^\"]+)"/);
    const algMatch = wwwAuth.match(/algorithm=([^,\s]+)/i);

    const realm = realmMatch ? realmMatch[1] : this.domain;
    const nonce = nonceMatch ? nonceMatch[1] : '';
    const qop = qopMatch ? qopMatch[1].split(',')[0].trim() : '';
    const algorithm = algMatch ? algMatch[1].replace(/"/g, '') : 'MD5';

    console.log(`Auth parameters parsed -> realm=${realm}, nonce=${nonce}, qop=${qop}, algorithm=${algorithm}, method=${method}`);

    if (!nonce) {
      console.error('No nonce in auth challenge');
      if (mainWindow) {
        mainWindow.webContents.send('sip:registration-status', 'Auth Failed');
      }
      return;
    }

    // Compute digest values for the given method
    let uri;
    if (method === 'REGISTER') {
      if (this.pendingRegister && this.pendingRegister.requestURI) {
        uri = this.pendingRegister.requestURI;
      } else {
        uri = this.authUriCandidates[this.authTryIndex % this.authUriCandidates.length];
      }
      console.log('Using URI for digest:', uri);
    } else if (method === 'INVITE' && relatedCall && relatedCall.inviteURI) {
      // Some servers validate digest URI with/without explicit port.
      if (!relatedCall.authUriCandidates) {
        const noPortUri = relatedCall.inviteURI.replace(/:(\d+)(?=\s*$)/, '');
        relatedCall.authUriCandidates = noPortUri !== relatedCall.inviteURI
          ? [relatedCall.inviteURI, noPortUri]
          : [relatedCall.inviteURI];
      }
      const uriIdx = relatedCall.authUriIndex || 0;
      uri = relatedCall.authUriCandidates[uriIdx % relatedCall.authUriCandidates.length];
      relatedCall.authUriIndex = uriIdx + 1;
      console.log('Using INVITE URI for digest:', uri);
    } else {
      uri = this.authUriCandidates[this.authTryIndex % this.authUriCandidates.length];
    }

    const username = this.username;
    const password = this.password;

    let ha1;
    let cnonce;
    if (algorithm.toLowerCase() === 'md5-sess') {
      const initial = this.md5Hash(`${username}:${realm}:${password}`);
      cnonce = crypto.randomBytes(8).toString('hex');
      ha1 = this.md5Hash(`${initial}:${nonce}:${cnonce}`);
    } else {
      ha1 = this.md5Hash(`${username}:${realm}:${password}`);
      if (qop) {
        cnonce = crypto.randomBytes(8).toString('hex');
      }
    }

    const ha2 = this.md5Hash(`${method}:${uri}`);

    let response;
    let authHeader = `Digest username="${username}", realm="${realm}", nonce="${nonce}", uri="${uri}", response="`;

    if (qop) {
      const nc = '00000001';
      response = this.md5Hash(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
      authHeader += `${response}", nc="${nc}", cnonce="${cnonce}", qop="${qop}"`;
    } else {
      response = this.md5Hash(`${ha1}:${nonce}:${ha2}`);
      authHeader += `${response}"`;
    }

    if (algorithm) {
      authHeader += `, algorithm=${algorithm}`;
    }

    this.authHeader = authHeader;
    console.log('Computed Authorization header for', method, ':', this.authHeader);

    if (method === 'REGISTER') {
      console.log('Sending authenticated REGISTER');
      this.registerWithAuth();
    } else if (method === 'INVITE') {
      console.log('Retrying INVITE with auth');
      this.resendInviteWithAuth(relatedCall);
    }
    // advance try index so next challenge will try a different URI if available
    if (method === 'REGISTER' && !this.pendingRegister) {
      this.authTryIndex++;
    }
  }

  registerWithAuth() {
    if (!this.pendingRegister) {
      // fallback to normal register if we lost state
      return this.register();
    }

    const { callID, branch, tag, via, from, to, contact } = this.pendingRegister;

    // Extract the URI from the Authorization header (it was used in the digest)
    const uriMatch = this.authHeader.match(/uri="([^"]+)"/);
    const requestURI = uriMatch ? uriMatch[1] : `sip:${this.domain}:${this.serverPort}`;

    let message = `REGISTER ${requestURI} SIP/2.0\r\n`;
    message += `Via: ${via}\r\n`;
    message += `From: ${from}\r\n`;
    message += `To: ${to}\r\n`;
    message += `Call-ID: ${callID}\r\n`;
    message += `CSeq: ${this.sequenceNumber} REGISTER\r\n`;
    message += `Contact: ${contact}\r\n`;
    message += `Authorization: ${this.authHeader}\r\n`;
    message += `Expires: 3600\r\n`;
    message += `Max-Forwards: 70\r\n`;
    message += `User-Agent: MicroSIP-Electron/1.0\r\n`;
    message += `Content-Length: 0\r\n`;
    message += `\r\n`;

    console.log('REGISTER with auth message body:\n' + message);
    this.sequenceNumber++;
    this.sendSIPMessage(message);
  }

  handleIncomingRequest(message, rinfo = null) {
    const lines = message.split('\r\n');
    const firstLine = lines[0];
    const method = firstLine.split(' ')[0];

    // Extract call-id, via, from, to headers for proper response
    let callID = '';
    let via = '';
    let cseq = '';
    let from = '';
    let to = '';

    for (const line of lines) {
      if (line.toLowerCase().startsWith('call-id:')) {
        callID = line.substring(line.indexOf(':') + 1).trim();
      }
      if (line.toLowerCase().startsWith('via:')) {
        via = line.substring(line.indexOf(':') + 1).trim();
      }
      if (line.toLowerCase().startsWith('cseq:')) {
        cseq = line.substring(line.indexOf(':') + 1).trim();
      }
      if (line.toLowerCase().startsWith('from:')) {
        from = line.substring(line.indexOf(':') + 1).trim();
      }
      if (line.toLowerCase().startsWith('to:')) {
        to = line.substring(line.indexOf(':') + 1).trim();
      }
    }

    // Build 200 OK response
    let response = `SIP/2.0 200 OK\r\n`;
    response += `Via: ${via}\r\n`;
    response += `From: ${from}\r\n`;
    response += `To: ${to}\r\n`;
    response += `Call-ID: ${callID}\r\n`;
    response += `CSeq: ${cseq}\r\n`;
    response += `Content-Length: 0\r\n`;
    response += `\r\n`;

    console.log(`↩️ Responding 200 OK to ${method}`);
    this.sendSIPMessage(
      response,
      rinfo ? rinfo.address : this.serverHost,
      rinfo ? rinfo.port : this.serverPort
    );
  }

  sendInviteAck(responseMessage, call) {
    const lines = responseMessage.split('\r\n');
    const getHeader = (name) => {
      const line = lines.find(l => l.toLowerCase().startsWith(`${name.toLowerCase()}:`));
      return line ? line.substring(line.indexOf(':') + 1).trim() : '';
    };

    const to = getHeader('To');
    const from = getHeader('From');
    const callID = getHeader('Call-ID');
    const cseq = getHeader('CSeq');
    const contact = getHeader('Contact');
    const cseqNumberMatch = cseq.match(/^(\d+)/);
    const cseqNumber = cseqNumberMatch ? cseqNumberMatch[1] : (call && call.inviteCSeq ? String(call.inviteCSeq) : '1');

    let requestURI = (call && call.inviteURI) ? call.inviteURI : `sip:${this.domain}:${this.serverPort}`;
    const contactUriMatch = contact.match(/<([^>]+)>/);
    if (contactUriMatch && contactUriMatch[1]) {
      requestURI = contactUriMatch[1];
    }
    const targetMatch = requestURI.match(/^sip:(?:[^@]+@)?([^:;>]+)(?::(\d+))?/i);
    const targetHost = targetMatch ? targetMatch[1] : this.serverHost;
    const targetPort = targetMatch && targetMatch[2] ? parseInt(targetMatch[2], 10) : this.serverPort;

    const via = `SIP/2.0/UDP ${this.localIP}:${this.localPort};branch=${this.generateBranch()}`;
    let ack = `ACK ${requestURI} SIP/2.0\r\n`;
    ack += `Via: ${via}\r\n`;
    ack += `From: ${from}\r\n`;
    ack += `To: ${to}\r\n`;
    ack += `Call-ID: ${callID}\r\n`;
    ack += `CSeq: ${cseqNumber} ACK\r\n`;
    ack += `Max-Forwards: 70\r\n`;
    ack += `User-Agent: MicroSIP-Electron/1.0\r\n`;
    ack += `Content-Length: 0\r\n`;
    ack += `\r\n`;

    this.sendSIPMessage(ack, targetHost, targetPort);
    console.log(`↩️ Sent ACK for call ${call ? call.id : callID}`);
  }

  handleIncomingBye(message, rinfo = null) {
    this.handleIncomingRequest(message, rinfo);

    const cidMatch = message.match(/Call-ID:\s*(\S+)/i);
    const callID = cidMatch ? cidMatch[1] : null;
    if (!callID) return;

    for (const [key, call] of this.activeCalls.entries()) {
      if (call.callID === callID) {
        if (call.state !== 'ended') {
          call.state = 'ended';
          if (mainWindow) {
            mainWindow.webContents.send('sip:call-state-change', { id: key, state: 'ended' });
          }
        }
        break;
      }
    }
  }

  handleIncomingCall(message) {
    const lines = message.split('\r\n');
    let fromLine = '';
    let callID = '';

    for (const line of lines) {
      if (line.includes('From:')) {
        fromLine = line;
      }
      if (line.includes('Call-ID:')) {
        callID = line.substring(line.indexOf(':') + 1).trim();
      }
    }

    // Extract caller info
    const callerMatch = fromLine.match(/sip:([^@]+)@([^>;>]+)/);
    const callerNumber = callerMatch ? callerMatch[1] : 'Unknown';

    // Store call info
    const callKey = 'incoming_' + Date.now();
    this.activeCalls.set(callKey, {
      id: callKey,
      direction: 'incoming',
      number: callerNumber,
      displayName: callerNumber,
      state: 'ringing',
      originalMessage: message,
    });

    // Notify React
    if (mainWindow) {
      mainWindow.webContents.send('sip:incoming-call', {
        id: callKey,
        number: callerNumber,
        displayName: callerNumber,
      });
    }
  }

  makeCall(destination) {
    console.log(`\n📞 makeCall() invoked for destination: ${destination}`);
    console.log(`   registered=${this.registered}, socket=${this.socket ? 'bound' : 'not bound'}`);
    
    if (!this.registered) {
      console.error('❌ Cannot make call: Not registered');
      throw new Error('Not registered');
    }

    this.callCounter++;
    const callID = this.generateCallID();
    const callKey = 'outgoing_' + this.callCounter;
    const branch = this.generateBranch();
    const tag = this.generateTag();
    
    console.log(`   callKey=${callKey}, callID=${callID}`);

    const via = `SIP/2.0/UDP ${this.localIP}:${this.localPort};branch=${branch}`;
    const from = `<sip:${this.username}@${this.domain}>;tag=${tag}`;
    const to = `<sip:${destination}@${this.domain}>`;
    const contact = `<sip:${this.username}@${this.localIP}:${this.localPort}>`;

    // store the request URI because auth calculations must use the same value
    const requestURI = `sip:${destination}@${this.domain}:${this.serverPort}`;

    let message = `INVITE ${requestURI} SIP/2.0\r\n`;
    message += `Via: ${via}\r\n`;
    message += `From: ${from}\r\n`;
    message += `To: ${to}\r\n`;
    message += `Call-ID: ${callID}\r\n`;
    message += `CSeq: ${this.sequenceNumber} INVITE\r\n`;
    message += `Contact: ${contact}\r\n`;
    message += `Allow: OPTIONS, INVITE, BYE, CANCEL\r\n`;
    message += `Content-Length: 0\r\n`;
    message += `User-Agent: MicroSIP-Electron/1.0\r\n`;
    message += `Max-Forwards: 70\r\n`;
    message += `\r\n`;

    this.activeCalls.set(callKey, {
      id: callKey,
      direction: 'outgoing',
      number: destination,
      displayName: destination,
      state: 'calling',
      callID: callID,
      startTime: new Date(),
      rawInvite: message, // kept for compatibility
      baseInvite: message, // pristine INVITE template for auth retries
      inviteURI: requestURI,
      inviteCSeq: this.sequenceNumber,
      inviteAuthAttempts: 0
    });

    console.log(`✓ Call stored in activeCalls: ${callKey}`);
    this.sequenceNumber++;
    console.log(`📤 About to send INVITE to ${destination}...`);
    this.sendSIPMessage(message);

    return callKey;
  }

  // resend an INVITE with the current Authorization header
  resendInviteWithAuth(call) {
    if (!call) {
      console.warn('resendInviteWithAuth called without call context');
      this.registerWithAuth();
      return;
    }

    call.inviteAuthAttempts = (call.inviteAuthAttempts || 0) + 1;
    if (call.inviteAuthAttempts > 3) {
      console.error(`❌ INVITE auth failed after ${call.inviteAuthAttempts - 1} attempts for call ${call.id}`);
      call.state = 'failed';
      if (mainWindow) {
        mainWindow.webContents.send('sip:call-state-change', { id: call.id, state: 'failed' });
      }
      return;
    }

    const sourceInvite = call.baseInvite || call.rawInvite;
    if (sourceInvite) {
      const lines = sourceInvite
        .split('\r\n')
        .filter(line => line.length > 0);

      const newBranch = this.generateBranch();
      const cseqValue = this.sequenceNumber;
      const viaValue = `SIP/2.0/UDP ${this.localIP}:${this.localPort};branch=${newBranch}`;

      let rebuilt = [];
      for (const line of lines) {
        if (/^Via:/i.test(line)) {
          rebuilt.push(`Via: ${viaValue}`);
          continue;
        }
        if (/^CSeq:/i.test(line)) {
          rebuilt.push(`CSeq: ${cseqValue} INVITE`);
          continue;
        }
        if (/^Authorization:/i.test(line)) {
          continue;
        }
        rebuilt.push(line);
      }

      const cseqIndex = rebuilt.findIndex(line => /^CSeq:/i.test(line));
      if (cseqIndex >= 0) {
        rebuilt.splice(cseqIndex + 1, 0, `Authorization: ${this.authHeader}`);
      } else {
        rebuilt.push(`Authorization: ${this.authHeader}`);
      }

      const newMsg = rebuilt.join('\r\n') + '\r\n\r\n';
      this.sequenceNumber++;
      this.sendSIPMessage(newMsg);
      console.log(`↩️ Resent INVITE with auth for call ${call.id} (attempt ${call.inviteAuthAttempts})`);
    } else {
      console.warn('Call object has no rawInvite, cannot resend');
      this.registerWithAuth();
    }
  }

  acceptCall(callKey) {
    const call = this.activeCalls.get(callKey);
    if (!call || call.direction !== 'incoming') {
      throw new Error('Call not found');
    }

    call.state = 'connected';
    if (mainWindow) {
      mainWindow.webContents.send('sip:call-state-change', {
        id: callKey,
        state: 'connected',
      });
    }
  }

  transferCall(callKey, target) {
    const call = this.activeCalls.get(callKey);
    if (!call) {
      throw new Error('Call not found');
    }
    if (call.state !== 'connected') {
      throw new Error('Call is not connected');
    }
    if (!target || !target.trim()) {
      throw new Error('Transfer target is required');
    }

    let referTo = target.trim();
    if (!/^sip:/i.test(referTo)) {
      if (referTo.includes('@')) {
        referTo = `sip:${referTo}`;
      } else {
        referTo = `sip:${referTo}@${this.domain}`;
      }
    }

    const requestURI = call.remoteTarget || call.inviteURI;
    const { host: targetHost, port: targetPort } = this.extractHostPortFromSipUri(requestURI);
    const via = `SIP/2.0/UDP ${this.localIP}:${this.localPort};branch=${this.generateBranch()}`;
    const from = call.fromHeader || `<sip:${this.username}@${this.domain}>`;
    const to = call.toHeader || `<sip:${call.number}@${this.domain}>`;
    const contact = `<sip:${this.username}@${this.localIP}:${this.localPort}>`;
    const cseq = this.sequenceNumber++;

    let message = `REFER ${requestURI} SIP/2.0\r\n`;
    message += `Via: ${via}\r\n`;
    message += `From: ${from}\r\n`;
    message += `To: ${to}\r\n`;
    message += `Call-ID: ${call.callID}\r\n`;
    message += `CSeq: ${cseq} REFER\r\n`;
    message += `Contact: ${contact}\r\n`;
    message += `Refer-To: <${referTo}>\r\n`;
    message += `Referred-By: <sip:${this.username}@${this.domain}>\r\n`;
    message += `Max-Forwards: 70\r\n`;
    message += `User-Agent: MicroSIP-Electron/1.0\r\n`;
    message += `Content-Length: 0\r\n`;
    message += `\r\n`;

    this.sendSIPMessage(message, targetHost, targetPort);
    this.notifyCall('info', `Transferindo chamada para ${referTo}`, callKey);
  }

  hangupCall(callKey) {
    const call = this.activeCalls.get(callKey);
    if (!call) {
      throw new Error('Call not found');
    }

    this.activeCalls.delete(callKey);

    if (mainWindow) {
      mainWindow.webContents.send('sip:call-state-change', {
        id: callKey,
        state: 'ended',
      });
    }
  }

  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.registered = false;
    this.activeCalls.clear();

    if (this.registrationTimeout) {
      clearTimeout(this.registrationTimeout);
    }
  }
}

// ============ Window Setup ============
function createWindow() {
  const bridge = ensureNativeBridge();
  if (bridge.exists() && process.platform === 'win32') {
    preferNativeEngine = true;
  }

  mainWindow = new BrowserWindow({
    width: WINDOW_NORMAL.width,
    height: WINDOW_NORMAL.height,
    minWidth: WINDOW_NORMAL.minWidth,
    minHeight: WINDOW_NORMAL.minHeight,
    resizable: true,
    maximizable: true,
    fullscreenable: false,
    autoHideMenuBar: true,
    title: 'ReactSIP',
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
    },
  });

  const distIndexPath = path.join(__dirname, '../renderer-dist/index.html');
  let devReloadAttempts = 0;

  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(distIndexPath);
  }

  mainWindow.webContents.on('did-fail-load', () => {
    if (isDev) {
      devReloadAttempts += 1;
      if (devReloadAttempts >= 3 && fs.existsSync(distIndexPath)) {
        mainWindow.loadFile(distIndexPath);
        return;
      }
      setTimeout(() => {
        if (mainWindow) {
          mainWindow.loadURL(DEV_SERVER_URL);
        }
      }, 1200);
    }
  });

  if (isDev) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (sipClient) {
      sipClient.disconnect();
      sipClient = null;
    }
    if (nativeSipBridge) {
      nativeSipBridge.stop();
      nativeSipBridge = null;
    }
    if (transcriptionBridge) {
      transcriptionBridge.stop();
      transcriptionBridge = null;
    }
    if (transcriptionWindow && !transcriptionWindow.isDestroyed()) {
      transcriptionWindow.close();
      transcriptionWindow = null;
    }
    app.quit();
  });

  mainWindow.on('maximize', () => emitRenderer('app:window-state', { maximized: true }));
  mainWindow.on('unmaximize', () => emitRenderer('app:window-state', { maximized: false }));
}

function createTranscriptionWindow() {
  if (transcriptionWindow && !transcriptionWindow.isDestroyed()) {
    transcriptionWindow.focus();
    return transcriptionWindow;
  }

  transcriptionWindow = new BrowserWindow({
    width: 540,
    height: 720,
    minWidth: 420,
    minHeight: 520,
    resizable: true,
    maximizable: true,
    autoHideMenuBar: true,
    title: 'ReactSIP Live Transcript',
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
    },
  });

  const distIndexPath = path.join(__dirname, '../renderer-dist/index.html');
  if (isDev) {
    transcriptionWindow.loadURL(`${DEV_SERVER_URL}#transcription`);
  } else {
    transcriptionWindow.loadFile(distIndexPath, { hash: 'transcription' });
  }

  transcriptionWindow.on('closed', () => {
    transcriptionWindow = null;
  });

  return transcriptionWindow;
}

// ============ App Events ============
app.on('ready', () => {
  configureMediaPermissions();
  createWindow();
  setupAutoUpdater();

  // Install transcription runtime in background on first startup (Windows).
  if (process.platform === 'win32' && app.isPackaged) {
    setTimeout(async () => {
      try {
        const bridge = ensureTranscriptionBridge();
        if (!bridge.exists()) {
          await ensureWhisperRuntime(false);
          bridge.refreshLaunch();
        }
      } catch (error) {
        emitTranscriptionStatus('runtime_error', { message: error.message });
      }
    }, 3500);
  }
});

app.on('before-quit', () => {
  if (updateCheckTimer) {
    clearInterval(updateCheckTimer);
    updateCheckTimer = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// ============ SIP IPC Handlers ============
ipcMain.handle('sip:connect', async (_event, settings) => {
  currentSettings = settings;
  try {
    if (sipClient) {
      sipClient.disconnect();
      sipClient = null;
    }

    if (shouldUseNativeEngine(settings)) {
      const bridge = ensureNativeBridge();
      console.log('[native-sip] using native engine for UDP media');
      await bridge.connect(settings);
      emitRenderer('sip:connection-status', 'Connecting');
      return { success: true, message: 'Native engine connecting', engine: 'native' };
    }

    console.log('\n' + '='.repeat(60));
    console.log('INICIANDO CONEXAO SIP');
    console.log('='.repeat(60));
    console.log(`Usuario: ${settings.username}`);
    console.log(`Dominio: ${settings.domain}`);
    console.log(`Senha: ${'*'.repeat(settings.password.length)}`);
    console.log('='.repeat(60) + '\n');

    sipClient = new SIPClient(settings);
    await sipClient.connect();

    return { success: true, message: 'Connected and registering', engine: 'legacy' };
  } catch (error) {
    console.error('Connect error:', error.message);
    emitRenderer('sip:engine-error', { code: 'CONNECT_FAILED', message: error.message });

    if (shouldUseNativeEngine(settings)) {
      try {
        console.warn('[native-sip] falling back to legacy SIPClient');
        sipClient = new SIPClient(settings);
        await sipClient.connect();
        return { success: true, message: 'Connected via legacy fallback', engine: 'legacy-fallback' };
      } catch (fallbackError) {
        return { success: false, error: fallbackError.message };
      }
    }

    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:disconnect', async () => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      try {
        await ensureNativeBridge().disconnect();
      } catch (error) {
        console.warn('[native-sip] disconnect warning:', error.message);
      }
    }

    if (sipClient) {
      sipClient.disconnect();
      sipClient = null;
    }

    emitRenderer('sip:connection-status', 'Disconnected');
    emitRenderer('sip:registration-status', 'Unregistered');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:call', async (_event, number) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      const result = await ensureNativeBridge().makeCall(number);
      return { success: true, callId: result.callId || `native_${Date.now()}` };
    }

    if (!sipClient || !sipClient.registered) {
      throw new Error('Not connected or registered');
    }

    const callID = sipClient.makeCall(number);
    return { success: true, callId: callID };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:hangup', async (_event, callId) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().hangup(callId);
      return { success: true };
    }

    if (!sipClient) {
      throw new Error('Not connected');
    }
    sipClient.hangupCall(callId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:transfer', async (_event, callId, target) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().transfer(callId, target);
      return { success: true };
    }

    if (!sipClient) {
      throw new Error('Not connected');
    }
    sipClient.transferCall(callId, target);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:mute', async (_event, callId, enabled) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().mute(callId, !!enabled);
      return { success: true };
    }

    return { success: false, error: 'Mute disponivel apenas no motor nativo UDP' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:hold', async (_event, callId, enabled) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().hold(callId, !!enabled);
      return { success: true };
    }

    return { success: false, error: 'Hold disponivel apenas no motor nativo UDP' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:send-dtmf', async (_event, callId, digits) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().sendDTMF(callId, String(digits || ''));
      return { success: true };
    }

    return { success: false, error: 'DTMF disponivel apenas no motor nativo UDP' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:accept', async (_event, callId) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().answer(callId);
      return { success: true };
    }

    if (!sipClient) {
      throw new Error('Not connected');
    }
    sipClient.acceptCall(callId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:reject', async (_event, callId) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().reject(callId);
      return { success: true };
    }

    if (!sipClient) {
      throw new Error('Not connected');
    }
    sipClient.hangupCall(callId);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:list-audio-devices', async () => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      const payload = await ensureNativeBridge().listAudioDevices();
      emitRenderer('sip:audio-devices', payload);
      return { success: true, ...payload };
    }
    return { success: true, inputs: [], outputs: [], source: 'renderer-fallback' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:set-audio-input-device', async (_event, deviceId) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().setAudioInputDevice(deviceId);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:set-audio-output-device', async (_event, deviceId) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().setAudioOutputDevice(deviceId);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:set-input-volume', async (_event, percent) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().setInputVolume(percent);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:set-output-volume', async (_event, percent) => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      await ensureNativeBridge().setOutputVolume(percent);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sip:ping-engine', async () => {
  try {
    if (shouldUseNativeEngine(currentSettings || {})) {
      const payload = await ensureNativeBridge().ping();
      return { success: true, ...payload, engine: 'native' };
    }
    return { success: true, engine: 'legacy', message: 'Native engine disabled' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.on('sip:register-event-listener', () => {
  // Event listener registered
});

ipcMain.handle('app:open-microphone-privacy-settings', async () => {
  try {
    if (process.platform === 'win32') {
      await shell.openExternal('ms-settings:privacy-microphone');
      return { success: true };
    }
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone');
      return { success: true };
    }
    return { success: false, error: 'Plataforma sem atalho automatico para privacidade de microfone' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app:check-for-updates', async () => {
  try {
    if (isDev || !app.isPackaged) {
      return { success: false, error: 'Updater disponivel apenas no app instalado' };
    }
    if (!autoUpdater) {
      return { success: false, error: 'Modulo electron-updater indisponivel nesta instalacao' };
    }

    const result = await autoUpdater.checkForUpdates();
    const hasUpdate = Boolean(result?.updateInfo?.version);
    return {
      success: true,
      checking: true,
      hasUpdate,
      version: result?.updateInfo?.version || null,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app:install-update-now', async () => {
  try {
    if (isDev || !app.isPackaged) {
      return { success: false, error: 'Updater disponivel apenas no app instalado' };
    }
    if (!autoUpdater) {
      return { success: false, error: 'Modulo electron-updater indisponivel nesta instalacao' };
    }

    setImmediate(() => {
      autoUpdater.quitAndInstall(false, true);
    });
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app:window-minimize', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  mainWindow.minimize();
  return { success: true };
});

ipcMain.handle('app:window-toggle-maximize', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
  return { success: true, maximized: mainWindow.isMaximized() };
});

ipcMain.handle('app:window-close', async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };
  mainWindow.close();
  return { success: true };
});

ipcMain.handle('app:set-hyper-compact-mode', async (_event, enabled) => {
  if (!mainWindow || mainWindow.isDestroyed()) return { success: false };

  const mode = enabled ? WINDOW_COMPACT : WINDOW_NORMAL;
  mainWindow.setMinimumSize(mode.minWidth, mode.minHeight);

  const [currentWidth, currentHeight] = mainWindow.getSize();
  const nextWidth = Math.min(currentWidth, mode.width);
  const nextHeight = Math.min(currentHeight, mode.height);
  mainWindow.setSize(Math.max(nextWidth, mode.minWidth), Math.max(nextHeight, mode.minHeight), true);

  return { success: true, compact: !!enabled };
});

ipcMain.handle('app:open-transcription-window', async () => {
  try {
    createTranscriptionWindow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('app:close-transcription-window', async () => {
  try {
    if (transcriptionWindow && !transcriptionWindow.isDestroyed()) {
      transcriptionWindow.close();
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('transcription:start', async (_event, options) => {
  try {
    const bridge = ensureTranscriptionBridge();
    if (!bridge.exists()) {
      await ensureWhisperRuntime(false);
      bridge.refreshLaunch();
    }
    const payload = await bridge.startSession(options || {});
    return { success: true, ...payload };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('transcription:ensure-runtime', async (_event, forceDownload = false) => {
  try {
    if (forceDownload && transcriptionBridge) {
      try {
        transcriptionBridge.stop();
      } catch {
        // noop
      }
      transcriptionBridge = null;
    }
    const payload = await ensureWhisperRuntime(!!forceDownload);
    const bridge = ensureTranscriptionBridge();
    bridge.refreshLaunch();
    return { success: true, ...payload };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('transcription:stop', async () => {
  try {
    if (!transcriptionBridge) return { success: true };
    await transcriptionBridge.stopSession();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('transcription:push-chunk', async (_event, chunk) => {
  try {
    const bridge = ensureTranscriptionBridge();
    await bridge.start();
    const payload = await bridge.transcribeChunk(chunk || {});
    return { success: true, ...payload };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
