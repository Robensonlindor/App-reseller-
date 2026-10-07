import React, { useRef, useState, useEffect } from 'react';
import { ShieldCheck, Clock, RefreshCw } from 'lucide-react';

interface TotpCodeInputProps {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  error?: string | null;
  label?: string;
  helperText?: string;
  showTimer?: boolean;
  autoFocus?: boolean;
}

export const TotpCodeInput: React.FC<TotpCodeInputProps> = ({
  value,
  onChange,
  onComplete,
  disabled = false,
  error = null,
  label = 'Code Google Authenticator (6 chiffres)',
  helperText = 'Saisissez le code temporaire à 6 chiffres généré par Google Authenticator.',
  showTimer = true,
  autoFocus = false
}) => {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [secondsLeft, setSecondsLeft] = useState<number>(() => 30 - (Math.floor(Date.now() / 1000) % 30));

  useEffect(() => {
    if (!showTimer) return;
    const interval = setInterval(() => {
      setSecondsLeft(30 - (Math.floor(Date.now() / 1000) % 30));
    }, 1000);
    return () => clearInterval(interval);
  }, [showTimer]);

  useEffect(() => {
    if (autoFocus && inputRefs.current[0] && !disabled) {
      inputRefs.current[0].focus();
    }
  }, [autoFocus, disabled]);

  const digits = Array.from({ length: 6 }, (_, i) => value[i] || '');

  const triggerChange = (newDigits: string[]) => {
    const joined = newDigits.join('').replace(/\D/g, '').slice(0, 6);
    onChange(joined);
    if (joined.length === 6 && onComplete) {
      onComplete(joined);
    }
  };

  const handleDigitChange = (index: number, rawVal: string) => {
    if (disabled) return;
    const cleaned = rawVal.replace(/\D/g, '');
    if (!cleaned) {
      const next = [...digits];
      next[index] = '';
      triggerChange(next);
      return;
    }

    // Handle multi-digit input or autofill
    if (cleaned.length > 1) {
      const next = [...digits];
      for (let i = 0; i < cleaned.length && index + i < 6; i++) {
        next[index + i] = cleaned[i];
      }
      triggerChange(next);
      const focusIdx = Math.min(index + cleaned.length, 5);
      inputRefs.current[focusIdx]?.focus();
      return;
    }

    const next = [...digits];
    next[index] = cleaned[0];
    triggerChange(next);

    if (index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    if (e.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        triggerChange(next);
      } else if (index > 0) {
        const next = [...digits];
        next[index - 1] = '';
        triggerChange(next);
        inputRefs.current[index - 1]?.focus();
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
      e.preventDefault();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
      e.preventDefault();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    if (disabled) return;
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const next = Array.from({ length: 6 }, (_, i) => pasted[i] || '');
    triggerChange(next);
    const focusIdx = Math.min(pasted.length, 5);
    inputRefs.current[focusIdx]?.focus();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="font-semibold text-slate-800 text-xs flex items-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-orange-600 shrink-0" />
          <span>{label}</span>
        </label>
        {showTimer && (
          <div className="flex items-center gap-1 text-[11px] font-mono text-slate-500">
            <Clock className="w-3 h-3 text-orange-500" />
            <span className={secondsLeft <= 5 ? 'text-red-600 font-bold' : 'text-slate-600'}>
              {secondsLeft}s
            </span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-6 gap-1.5 sm:gap-2">
        {digits.map((digit, idx) => (
          <input
            key={idx}
            ref={(el) => {
              inputRefs.current[idx] = el;
            }}
            type="text"
            inputMode="numeric"
            autoComplete={idx === 0 ? 'one-time-code' : 'off'}
            maxLength={6}
            disabled={disabled}
            value={digit}
            onChange={(e) => handleDigitChange(idx, e.target.value)}
            onKeyDown={(e) => handleKeyDown(idx, e)}
            onPaste={handlePaste}
            aria-label={`Chiffre ${idx + 1} du code TOTP`}
            className={`w-full h-11 text-center font-mono text-base font-bold rounded-xl border transition-all focus:outline-none focus:ring-2 ${
              error
                ? 'border-red-400 bg-red-50/50 text-red-900 focus:border-red-500 focus:ring-red-500/20'
                : digit
                ? 'border-orange-500 bg-orange-50/30 text-slate-900 focus:border-orange-600 focus:ring-orange-500/20'
                : 'border-slate-300 bg-white text-slate-900 focus:border-orange-500 focus:ring-orange-500/20'
            } disabled:opacity-50`}
          />
        ))}
      </div>

      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-500 leading-snug">{helperText}</span>
        {value.length > 0 && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange('');
              inputRefs.current[0]?.focus();
            }}
            className="text-slate-400 hover:text-slate-700 font-medium shrink-0 ml-2 flex items-center gap-0.5"
          >
            <RefreshCw className="w-2.5 h-2.5" />
            <span>Effacer</span>
          </button>
        )}
      </div>

      {error && (
        <p className="text-[11px] font-medium text-red-600">{error}</p>
      )}
    </div>
  );
};
