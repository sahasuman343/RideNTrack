'use client';

import { useEffect, useRef, useState } from 'react';
import {
  authProblem, cleanOtp, formatLoginPhone, otpProblem, phoneProblem,
  OTP_LENGTH, OTP_RESEND_SECONDS, type AuthProblem,
} from '@ridentrack/shared';

/** Phone sign-in shows only once SMS codes are set up (docs/features/phone-login.md). */
export const PHONE_LOGIN_ENABLED = process.env.NEXT_PUBLIC_PHONE_LOGIN === 'true';

/** Throw this from onSend after showing your own field errors. */
export const HANDLED = Object.assign(new Error('handled'), { code: 'handled' });

export type SignInMethod = 'email' | 'phone';

export function SignInMethodSwitch({ value, onChange }: { value: SignInMethod; onChange: (m: SignInMethod) => void }) {
  return (
    <div role="tablist" aria-label="Sign in with" className="mb-5 grid grid-cols-2 gap-1 rounded border border-line2 p-1">
      {(['email', 'phone'] as const).map(m => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={value === m}
          onClick={() => onChange(m)}
          className={'rounded px-3 py-2 text-sm ' + (value === m ? 'bg-accent text-on-accent font-semibold' : 'text-muted hover:text-fg')}
        >
          {m === 'email' ? 'Email' : 'Phone'}
        </button>
      ))}
    </div>
  );
}

interface Props {
  mode: 'sign_in' | 'sign_up';
  /** Sends the code and returns the number in E.164. */
  onSend: (phone: string) => Promise<string>;
  onVerify: (e164: string, code: string) => Promise<void>;
  /** Problems that don't belong to the phone or code field. */
  onProblem: (p: AuthProblem) => void;
  sendLabel?: string;
  verifyLabel?: string;
  idPrefix?: string;
}

/** Two steps: the number, then the 6-digit code with a resend timer. */
export default function PhoneCodeForm({ mode, onSend, onVerify, onProblem, sendLabel = 'Send code', verifyLabel = 'Verify and sign in', idPrefix = 'phone' }: Props) {
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState('');
  const [wait, setWait] = useState(0);
  const codeInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait(w => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  useEffect(() => { if (sentTo) codeInput.current?.focus(); }, [sentTo]);

  function fail(error: unknown) {
    if ((error as { code?: string })?.code === 'handled') return;
    const p = authProblem(error as { message?: string; code?: string; status?: number }, mode);
    if ((p.field === 'phone' || p.field === 'code') && !p.next) { setFieldError(p.message); return; }
    if (p.field === 'phone' || p.field === 'code') setFieldError(p.title);
    onProblem(p);
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy) return;
    const problem = phoneProblem(phone);
    if (problem) { setFieldError(problem); return; }
    setBusy(true);
    setFieldError('');
    try {
      const e164 = await onSend(phone);
      setSentTo(e164);
      setCode('');
      setWait(OTP_RESEND_SECONDS);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (busy || !sentTo) return;
    const problem = otpProblem(code);
    if (problem) { setFieldError(problem); return; }
    setBusy(true);
    setFieldError('');
    try {
      await onVerify(sentTo, code);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }

  const errorId = `${idPrefix}-error`;
  if (!sentTo) {
    return (
      <form onSubmit={send} className="space-y-4" noValidate>
        <div>
          <label htmlFor={`${idPrefix}-number`} className="field-label">Mobile number</label>
          <input
            id={`${idPrefix}-number`}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="98765 43210"
            value={phone}
            onChange={e => { setPhone(e.target.value); setFieldError(''); }}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? errorId : `${idPrefix}-hint`}
            className="field"
            required
          />
          {fieldError
            ? <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger">{fieldError}</p>
            : <p id={`${idPrefix}-hint`} className="mt-1.5 text-xs text-muted">Indian numbers need no +91. We text you a 6-digit code.</p>}
        </div>
        <button type="submit" disabled={busy} className="btn btn-primary w-full py-3">{busy ? 'Sending…' : sendLabel}</button>
      </form>
    );
  }

  return (
    <form onSubmit={verify} className="space-y-4" noValidate>
      <p role="status" className="text-sm text-muted">We texted a code to <strong className="text-fg">{formatLoginPhone(sentTo)}</strong>.</p>
      <div>
        <label htmlFor={`${idPrefix}-code`} className="field-label">Code</label>
        <input
          ref={codeInput}
          id={`${idPrefix}-code`}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={OTP_LENGTH + 2}
          value={code}
          onChange={e => { setCode(cleanOtp(e.target.value)); setFieldError(''); }}
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? errorId : undefined}
          className="field font-mono tracking-[0.4em]"
          required
        />
        {fieldError && <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger">{fieldError}</p>}
      </div>
      <button type="submit" disabled={busy} className="btn btn-primary w-full py-3">{busy ? 'Checking…' : verifyLabel}</button>
      <div className="flex justify-between text-sm">
        <button type="button" className="text-accent underline-offset-4 hover:underline" onClick={() => { setSentTo(null); setCode(''); setFieldError(''); }}>Change number</button>
        <button type="button" disabled={wait > 0 || busy} className="text-accent underline-offset-4 hover:underline disabled:text-muted disabled:no-underline" onClick={() => void send()}>
          {wait > 0 ? `Resend in ${wait}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}
