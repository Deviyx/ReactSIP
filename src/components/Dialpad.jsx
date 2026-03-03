import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Delete } from 'lucide-react';
import { useSIP } from '../hooks/useSIP';
import { useDtmfTone } from '../hooks/useDtmfTone';

const DIAL_KEYS = [
  ['1', ''],
  ['2', 'ABC'],
  ['3', 'DEF'],
  ['4', 'GHI'],
  ['5', 'JKL'],
  ['6', 'MNO'],
  ['7', 'PQRS'],
  ['8', 'TUV'],
  ['9', 'WXYZ'],
  ['*', ''],
  ['0', '+'],
  ['#', ''],
];

const MIN_FONT = 22;
const MAX_FONT = 56;

const Dialpad = () => {
  const [number, setNumber] = useState('');
  const [pressedKey, setPressedKey] = useState(null);
  const { makeCall } = useSIP();
  const { playTone } = useDtmfTone();
  const pressTimerRef = useRef(null);

  const onDial = (digit) => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
    }
    setPressedKey(digit);
    pressTimerRef.current = setTimeout(() => setPressedKey(null), 120);
    playTone(digit);
    setNumber((prev) => `${prev}${digit}`);
  };

  const onBackspace = () => {
    setNumber((prev) => prev.slice(0, -1));
  };

  const onClear = () => {
    setNumber('');
  };

  const onCall = () => {
    const target = number.trim();
    if (!target) return;
    makeCall(target);
  };

  const displayFontSize = useMemo(() => {
    if (!number) return MAX_FONT;

    const isNumeric = /^[0-9*#+]+$/.test(number);
    const maxChars = isNumeric ? 14 : 22;
    const ratio = Math.min(number.length / maxChars, 1);
    const computed = MAX_FONT - (MAX_FONT - MIN_FONT) * ratio;
    return Math.max(MIN_FONT, Math.min(MAX_FONT, computed));
  }, [number]);

  useEffect(() => () => {
    if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
  }, []);

  return (
    <div className="surface-card dialpad-root">
      <div className="dial-header">Discador</div>

      <div className="dial-display-wrap">
        <input
          type="text"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          className="dial-display-input"
          placeholder=""
          aria-label="Número para ligar"
        />

        <div className="dial-display-overlay" aria-hidden="true" style={{ '--display-font-size': `${displayFontSize}px` }}>
          {number ? (
            number.split('').map((char, index) => (
              <span key={`${index}-${char}`} className="dial-char dial-char-static">
                {char}
              </span>
            ))
          ) : (
            <span className="dial-placeholder">Número ou SIP</span>
          )}
        </div>

        <button
          type="button"
          className="dial-backspace"
          onClick={onBackspace}
          disabled={!number}
          aria-label="Apagar último dígito"
        >
          <Delete size={16} />
        </button>
      </div>

      <div className="dial-grid">
        {DIAL_KEYS.map(([digit, letters]) => (
          <button
            key={digit}
            type="button"
            className={`dial-key ${pressedKey === digit ? 'dial-key-pressed' : ''}`}
            onClick={() => onDial(digit)}
          >
            <span className="dial-key-digit">{digit}</span>
            <span className="dial-key-letters">{letters || '\u00A0'}</span>
          </button>
        ))}
      </div>

      <div className="dial-actions">
        <button
          type="button"
          className="dial-action-btn"
          onClick={onBackspace}
          disabled={!number}
        >
          Apagar
        </button>
        <button
          type="button"
          className="dial-action-btn dial-action-primary"
          onClick={onCall}
          disabled={!number}
        >
          Ligar
        </button>
        <button
          type="button"
          className="dial-action-btn"
          onClick={onClear}
          disabled={!number}
        >
          Limpar
        </button>
      </div>
    </div>
  );
};

export default Dialpad;
