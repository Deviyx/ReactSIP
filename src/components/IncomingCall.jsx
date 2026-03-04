import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff } from 'lucide-react';
import { useSIPContext } from '../context/SIPContext';
import { useSIP } from '../hooks/useSIP';

const IncomingCall = () => {
  const { incomingCallData } = useSIPContext();
  const { answerCall, hangupCall } = useSIP();
  const [ignoredCallId, setIgnoredCallId] = useState(null);
  const audioContextRef = useRef(null);
  const ringIntervalRef = useRef(null);

  const stopRingtone = useCallback(() => {
    if (ringIntervalRef.current) {
      clearInterval(ringIntervalRef.current);
      ringIntervalRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(async () => {
    if (audioContextRef.current) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    const ctx = new Ctx();
    audioContextRef.current = ctx;
    await ctx.resume().catch(() => {});

    const playBurst = () => {
      if (ctx.state === 'closed') {
        stopRingtone();
        return;
      }
      try {
        const now = ctx.currentTime;
        [440, 554].forEach((freq) => {
          if (ctx.state === 'closed') return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.linearRampToValueAtTime(0.06, now + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now);
          osc.stop(now + 0.25);
        });
      } catch {
        stopRingtone();
      }
    };

    playBurst();
    ringIntervalRef.current = setInterval(playBurst, 1600);
  }, []);

  useEffect(() => {
    if (!incomingCallData) {
      stopRingtone();
      setIgnoredCallId(null);
      return;
    }

    if (ignoredCallId === incomingCallData.id) {
      stopRingtone();
      return;
    }

    startRingtone().catch(() => {});
  }, [ignoredCallId, incomingCallData, startRingtone, stopRingtone]);

  useEffect(() => () => stopRingtone(), [stopRingtone]);

  if (!incomingCallData) return null;
  if (ignoredCallId === incomingCallData.id) return null;

  const callerLabel = incomingCallData.number || incomingCallData.displayName || 'Unknown';

  return (
    <div className="incoming-toast-wrap">
      <div className="incoming-toast">
        <div className="incoming-toast-head">
          <div className="incoming-toast-id">
            <Phone size={14} />
            <span>Incoming call</span>
          </div>
          <span className="incoming-toast-pulse" aria-hidden="true" />
        </div>

        <div className="incoming-toast-number" title={callerLabel}>{callerLabel}</div>

        <div className="incoming-toast-actions">
          <button
            type="button"
            onClick={async () => {
              stopRingtone();
              await answerCall(incomingCallData.id);
            }}
            className="incoming-toast-btn incoming-toast-answer"
            aria-label="Answer call"
            title="Answer call"
          >
            <Phone size={14} />
            <span>Answer</span>
          </button>

          <button
            type="button"
            onClick={async () => {
              stopRingtone();
              await hangupCall(incomingCallData.id);
            }}
            className="incoming-toast-btn incoming-toast-hangup"
            aria-label="Hang up call"
            title="Hang up call"
          >
            <PhoneOff size={14} />
            <span>Hang up</span>
          </button>

          <button
            type="button"
            onClick={() => {
              stopRingtone();
              setIgnoredCallId(incomingCallData.id);
            }}
            className="incoming-toast-btn incoming-toast-ignore"
            aria-label="Ignore call"
            title="Ignore call"
          >
            <PhoneOff size={14} />
            <span>Ignore</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default IncomingCall;
