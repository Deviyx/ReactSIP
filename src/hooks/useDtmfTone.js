import { useCallback, useRef } from 'react';

const DTMF_MAP = {
  '1': [697, 1209],
  '2': [697, 1336],
  '3': [697, 1477],
  '4': [770, 1209],
  '5': [770, 1336],
  '6': [770, 1477],
  '7': [852, 1209],
  '8': [852, 1336],
  '9': [852, 1477],
  '*': [941, 1209],
  '0': [941, 1336],
  '#': [941, 1477],
};

export const useDtmfTone = () => {
  const audioCtxRef = useRef(null);

  const ensureContext = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    if (audioCtxRef.current && audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = null;
    }
    if (!audioCtxRef.current) {
      audioCtxRef.current = new Ctx();
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume().catch(() => {});
    }
    return audioCtxRef.current;
  }, []);

  const playTone = useCallback((digit, durationMs = 90) => {
    const freqs = DTMF_MAP[String(digit)];
    if (!freqs) return;

    const ctx = ensureContext();
    if (!ctx) return;

    if (ctx.state === 'closed') return;
    try {
      const now = ctx.currentTime;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.14, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
      gain.connect(ctx.destination);

      freqs.forEach((freq) => {
        if (ctx.state === 'closed') return;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now);
        osc.connect(gain);
        osc.start(now);
        osc.stop(now + durationMs / 1000 + 0.015);
      });
    } catch {
      // Context changed while building DTMF graph; ignore safely.
    }
  }, [ensureContext]);

  return { playTone };
};
