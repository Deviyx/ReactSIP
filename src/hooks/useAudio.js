import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

export const useAudio = (options = {}) => {
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;
  const autoRequest = typeof options === 'boolean' ? options : options.autoRequest !== false;

  const [micPermission, setMicPermission] = useState(null);
  const [micLevel, setMicLevel] = useState(0);
  const [inputDevices, setInputDevices] = useState([]);
  const [outputDevices, setOutputDevices] = useState([]);
  const [selectedInputDeviceId, setSelectedInputDeviceId] = useState('default');
  const [selectedOutputDeviceId, setSelectedOutputDeviceId] = useState('default');
  const [inputVolume, setInputVolumeState] = useState(100);
  const [outputVolume, setOutputVolumeState] = useState(100);
  const [isMonitoringInput, setIsMonitoringInput] = useState(false);

  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationIdRef = useRef(null);
  const streamRef = useRef(null);
  const monitorGainRef = useRef(null);
  const monitorDestinationRef = useRef(null);
  const monitorAudioElRef = useRef(null);

  const stopLevelLoop = useCallback(() => {
    if (animationIdRef.current) {
      cancelAnimationFrame(animationIdRef.current);
      animationIdRef.current = null;
    }
  }, []);

  const startLevelLoop = useCallback(() => {
    if (!analyserRef.current) return;
    const analyser = analyserRef.current;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const updateLevel = () => {
      analyser.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
      setMicLevel(Math.min(100, (average / 255) * 100));
      animationIdRef.current = requestAnimationFrame(updateLevel);
    };
    updateLevel();
  }, []);

  const closeAudioGraph = useCallback(() => {
    stopLevelLoop();
    setMicLevel(0);
    if (monitorAudioElRef.current) {
      monitorAudioElRef.current.pause();
      monitorAudioElRef.current.srcObject = null;
      monitorAudioElRef.current = null;
    }
    monitorGainRef.current = null;
    monitorDestinationRef.current = null;
    analyserRef.current = null;

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, [stopLevelLoop]);

  const stopInputStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const enumerateDevices = useCallback(async () => {
    if (isElectron && window.electronAPI?.sip?.listAudioDevices) {
      try {
        const result = await window.electronAPI.sip.listAudioDevices();
        if (result?.success) {
          setInputDevices(Array.isArray(result.inputs) ? result.inputs : []);
          setOutputDevices(Array.isArray(result.outputs) ? result.outputs : []);
          return;
        }
      } catch (error) {
        console.warn('Native audio device list failed, falling back to browser API:', error);
      }
    }

    try {
      const deviceList = await navigator.mediaDevices.enumerateDevices();
      setInputDevices(deviceList.filter((device) => device.kind === 'audioinput'));
      setOutputDevices(deviceList.filter((device) => device.kind === 'audiooutput'));
    } catch (error) {
      console.error('Error enumerating devices:', error);
    }
  }, []);

  const setupGraph = useCallback(async (stream) => {
    closeAudioGraph();

    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    audioContextRef.current = audioContext;
    await audioContext.resume().catch(() => {});

    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    analyserRef.current = analyser;
    source.connect(analyser);

    const gain = audioContext.createGain();
    gain.gain.value = inputVolume / 100;
    monitorGainRef.current = gain;
    source.connect(gain);

    const destination = audioContext.createMediaStreamDestination();
    monitorDestinationRef.current = destination;
    gain.connect(destination);

    startLevelLoop();
  }, [closeAudioGraph, inputVolume, startLevelLoop]);

  const requestMicrophone = useCallback(async (deviceId = selectedInputDeviceId) => {
    const openMic = async (targetDeviceId) => {
      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
      };

      if (targetDeviceId && targetDeviceId !== 'default') {
        constraints.audio.deviceId = { exact: targetDeviceId };
      }

      stopInputStream();
      return navigator.mediaDevices.getUserMedia(constraints);
    };

    try {
      let stream;
      try {
        stream = await openMic(deviceId);
      } catch (innerError) {
        if (innerError?.name === 'OverconstrainedError' && deviceId && deviceId !== 'default') {
          // DeviceId may come from native SIP engine list (not browser mediaDevices id).
          stream = await openMic('default');
        } else {
          throw innerError;
        }
      }
      streamRef.current = stream;
      setMicPermission(true);
      await setupGraph(stream);
      await enumerateDevices();
      return stream;
    } catch (error) {
      console.error('Microphone request failed:', error);
      const errorName = error?.name || '';
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError') {
        setMicPermission(false);
        toast.error('Permissao de microfone negada.');
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setMicPermission(null);
        toast.error('Nenhum microfone disponivel neste dispositivo.');
      } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        setMicPermission(null);
        toast.error('Microphone is busy in another application.');
      } else {
        setMicPermission(null);
        toast.error(`Failed to open microphone: ${errorName || 'unknown error'}`);
      }
      throw error;
    }
  }, [enumerateDevices, selectedInputDeviceId, setupGraph, stopInputStream]);

  const setInputVolume = useCallback((value) => {
    const normalized = Math.max(0, Math.min(150, Number(value) || 0));
    setInputVolumeState(normalized);
    if (isElectron && window.electronAPI?.sip?.setInputVolume) {
      window.electronAPI.sip.setInputVolume(normalized).catch(() => {});
    }
    if (monitorGainRef.current) {
      monitorGainRef.current.gain.value = normalized / 100;
    }
  }, [isElectron]);

  const setOutputVolume = useCallback((value) => {
    const normalized = Math.max(0, Math.min(150, Number(value) || 0));
    setOutputVolumeState(normalized);
    if (isElectron && window.electronAPI?.sip?.setOutputVolume) {
      window.electronAPI.sip.setOutputVolume(normalized).catch(() => {});
    }
    if (monitorAudioElRef.current) {
      monitorAudioElRef.current.volume = normalized / 100;
    }
  }, [isElectron]);

  const selectInputDevice = useCallback(async (deviceId) => {
    setSelectedInputDeviceId(deviceId || 'default');
    if (isElectron && window.electronAPI?.sip?.setAudioInputDevice) {
      const result = await window.electronAPI.sip.setAudioInputDevice(deviceId || 'default');
      if (!result?.success) {
        throw new Error(result?.error || 'Failed to select audio input in engine');
      }
      // In native UDP mode, the media path is handled by sip-agent. Browser capture is optional.
      return;
    }
    await requestMicrophone(deviceId || 'default');
  }, [isElectron, requestMicrophone]);

  const selectOutputDevice = useCallback(async (deviceId) => {
    setSelectedOutputDeviceId(deviceId || 'default');
    if (isElectron && window.electronAPI?.sip?.setAudioOutputDevice) {
      await window.electronAPI.sip.setAudioOutputDevice(deviceId || 'default');
    }
    if (monitorAudioElRef.current && typeof monitorAudioElRef.current.setSinkId === 'function') {
      try {
        await monitorAudioElRef.current.setSinkId(deviceId || 'default');
      } catch (error) {
        console.warn('setSinkId failed:', error);
      }
    }
  }, [isElectron]);

  const startInputMonitoring = useCallback(async () => {
    if (!streamRef.current) {
      await requestMicrophone(selectedInputDeviceId);
    }
    const monitorStream = monitorDestinationRef.current?.stream || streamRef.current;
    if (!monitorStream) return;

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume().catch(() => {});
    }

    const audio = new Audio();
    audio.autoplay = true;
    audio.muted = false;
    audio.volume = outputVolume / 100;
    audio.srcObject = monitorStream;
    if (typeof audio.setSinkId === 'function' && selectedOutputDeviceId) {
      try {
        await audio.setSinkId(selectedOutputDeviceId);
      } catch (error) {
        console.warn('setSinkId failed:', error);
      }
    }
    await audio.play().catch((error) => {
      console.warn('Failed to start input monitoring playback:', error);
      throw error;
    });
    monitorAudioElRef.current = audio;
    setIsMonitoringInput(true);
  }, [outputVolume, requestMicrophone, selectedInputDeviceId, selectedOutputDeviceId]);

  const stopInputMonitoring = useCallback(() => {
    if (monitorAudioElRef.current) {
      monitorAudioElRef.current.pause();
      monitorAudioElRef.current.srcObject = null;
      monitorAudioElRef.current = null;
    }
    setIsMonitoringInput(false);
  }, []);

  const playOutputTestTone = useCallback(async () => {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const destination = audioContext.createMediaStreamDestination();

    oscillator.type = 'sine';
    oscillator.frequency.value = 700;
    gain.gain.value = Math.max(0.0001, outputVolume / 100);
    oscillator.connect(gain);
    gain.connect(destination);

    const audio = new Audio();
    audio.srcObject = destination.stream;
    audio.volume = 1;
    if (typeof audio.setSinkId === 'function' && selectedOutputDeviceId) {
      try {
        await audio.setSinkId(selectedOutputDeviceId);
      } catch (error) {
        console.warn('setSinkId failed:', error);
      }
    }

    await audio.play();
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.35);

    setTimeout(() => {
      audio.pause();
      audio.srcObject = null;
      audioContext.close().catch(() => {});
    }, 500);
  }, [outputVolume, selectedOutputDeviceId]);

  useEffect(() => {
    if (isElectron && window.electronAPI?.onAudioDevices) {
      window.electronAPI.onAudioDevices((payload) => {
        if (Array.isArray(payload?.inputs)) setInputDevices(payload.inputs);
        if (Array.isArray(payload?.outputs)) setOutputDevices(payload.outputs);
      });
    }
    if (isElectron && window.electronAPI?.onAudioLevel) {
      window.electronAPI.onAudioLevel((payload) => {
        if (typeof payload?.inputLevel === 'number') {
          setMicLevel(Math.max(0, Math.min(100, payload.inputLevel)));
        }
      });
    }

    enumerateDevices();
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
    }
    return () => {
      if (navigator.mediaDevices?.removeEventListener) {
        navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
      }
    };
  }, [enumerateDevices, isElectron]);

  useEffect(() => {
    if (!autoRequest) return;
    requestMicrophone().catch(() => {});
    return () => {
      stopInputMonitoring();
      stopInputStream();
      closeAudioGraph();
    };
  }, [autoRequest, closeAudioGraph, requestMicrophone, stopInputMonitoring, stopInputStream]);

  return {
    micPermission,
    micLevel,
    inputDevices,
    outputDevices,
    selectedInputDeviceId,
    selectedOutputDeviceId,
    inputVolume,
    outputVolume,
    isMonitoringInput,
    requestMicrophone,
    selectInputDevice,
    selectOutputDevice,
    setInputVolume,
    setOutputVolume,
    startInputMonitoring,
    stopInputMonitoring,
    playOutputTestTone,
    stream: streamRef.current,
    // backward compatibility
    devices: inputDevices,
    selectDevice: selectInputDevice,
  };
};

