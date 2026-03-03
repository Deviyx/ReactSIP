import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { useSIP } from '../hooks/useSIP';
import { useDtmfTone } from '../hooks/useDtmfTone';

const DIAL_KEYS = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

const MAX_FONT = 40;
const MIN_FONT = 18;
const DTMF_CHARS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#']);

const Dialpad = () => {
  const [number, setNumber] = useState('');
  const [pressedKey, setPressedKey] = useState(null);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { makeCall } = useSIP();
  const { playTone } = useDtmfTone();
  const pressTimerRef = useRef(null);
  const keyboardTonePendingRef = useRef(false);

  const triggerKeyFeedback = (digit) => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
    setPressedKey(digit);
    pressTimerRef.current = setTimeout(() => setPressedKey(null), 120);
    playTone(digit);
  };

  const onDial = (digit) => {
    triggerKeyFeedback(digit);
    setNumber((prev) => `${prev}${digit}`);
  };

  const onBackspace = () => setNumber((prev) => prev.slice(0, -1));
  const onClear = () => setNumber('');

  const onCall = () => {
    const target = number.trim();
    if (!target) return;
    makeCall(target);
  };

  const onDisplayKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      onCall();
      return;
    }
    if (DTMF_CHARS.has(event.key)) {
      keyboardTonePendingRef.current = true;
      triggerKeyFeedback(event.key);
    }
  };

  const displayFontSize = useMemo(() => {
    if (!number) return MAX_FONT;
    const isNumeric = /^[0-9*#+]+$/.test(number);
    const maxChars = isNumeric ? 14 : 22;
    const ratio = Math.min(number.length / maxChars, 1);
    const computed = MAX_FONT - (MAX_FONT - MIN_FONT) * ratio;
    return Math.max(MIN_FONT, Math.min(MAX_FONT, computed));
  }, [number]);

  const displayTopPadding = useMemo(() => {
    const ratio = (displayFontSize - MIN_FONT) / (MAX_FONT - MIN_FONT || 1);
    const dynamic = 9 + ratio * 9;
    return Math.round(Math.max(8, Math.min(18, dynamic)));
  }, [displayFontSize]);

  const displayOffsetY = useMemo(() => Math.round((displayTopPadding - 12) * 0.65), [displayTopPadding]);

  useEffect(() => () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  }, []);

  return (
    <div className="surface-card dialpad-root">
      <div className="dial-header">Dialer</div>

      <div className={`dial-display-wrap ${isInputFocused ? 'dial-display-wrap-focused' : ''}`}>
        <input
          type="text"
          value={number}
          onChange={(e) => {
            const nextValue = e.target.value;
            if (nextValue.length > number.length) {
              if (keyboardTonePendingRef.current) {
                keyboardTonePendingRef.current = false;
              } else {
                const inserted = nextValue.slice(number.length);
                const toneChar = inserted.split('').find((char) => DTMF_CHARS.has(char));
                if (toneChar) triggerKeyFeedback(toneChar);
              }
            }
            setNumber(nextValue);
          }}
          onKeyDown={onDisplayKeyDown}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => setIsInputFocused(false)}
          className="dial-display-input"
          placeholder=""
          aria-label="Number to call"
          title="Type a number or SIP URI and press Enter to call"
        />
        <span className={`dial-focus-chip ${isInputFocused ? 'dial-focus-chip-on' : ''}`}>
          {isInputFocused ? 'Typing' : 'Click to type'}
        </span>

        <div
          className="dial-display-overlay"
          aria-hidden="true"
          style={{
            '--display-font-size': `${displayFontSize}px`,
            '--display-top-padding': `${displayTopPadding}px`,
            '--display-offset-y': `${displayOffsetY}px`,
          }}
        >
          {number ? number.split('').map((char, index) => (
            <span key={`${index}-${char}`} className="dial-char dial-char-static">{char}</span>
          )) : <span className="dial-placeholder"></span>}
        </div>

        <button type="button" className="dial-backspace" onClick={onBackspace} disabled={!number} aria-label="Delete last digit" title="Delete last digit">
          <Delete size={16} />
        </button>
      </div>

      <div className="dial-grid">
        {DIAL_KEYS.map(([digit, letters]) => (
          <button key={digit} type="button" className={`dial-key ${pressedKey === digit ? 'dial-key-pressed' : ''}`} onClick={() => onDial(digit)} title={`Type ${digit}`}>
            <span className="dial-key-digit">{digit}</span>
            <span className="dial-key-letters">{letters || '\u00A0'}</span>
          </button>
        ))}
      </div>

      <div className="dial-actions">
        <button type="button" className="dial-action-btn" onClick={onBackspace} disabled={!number} title="Delete last digit">Delete</button>
        <button type="button" className="dial-action-btn dial-action-primary" onClick={onCall} disabled={!number} title="Call typed number">Call</button>
        <button type="button" className="dial-action-btn" onClick={onClear} disabled={!number} title="Clear number">Clear</button>
      </div>
    </div>
  );
};

export default Dialpad;
