import axios from 'axios';
import { type ClipboardEvent, type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { defaultRouteForRole } from '../config/navigation';
import { useAuthStore } from '../store/authStore';
import type { SessionUser } from '../types/auth';

type Step = 'credentials' | 'setup' | 'totp';
type LoginResponse = { pendingToken: string; twoFactorConfigured: boolean };
type SetupResponse = { qrCodeDataUrl: string; manualEntryKey: string };
type VerifyResponse = { token: string; user: SessionUser };
function messageFor(error: unknown) {
  if (!axios.isAxiosError(error)) return 'Something went wrong. Please try again.';
  if (error.response?.status === 429) return 'Too many attempts. Try again shortly.';
  if (error.response?.status === 401) return 'Incorrect email, password, or authentication code.';
  return error.response?.data?.error ?? 'Unable to sign in. Please try again.';
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<Step>('credentials');
  const [pendingToken, setPendingToken] = useState('');
  const [setup, setSetup] = useState<SetupResponse | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const login = useAuthStore((state) => state.login);
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const location = useLocation();
  const signupSuccess = Boolean((location.state as { signupSuccess?: boolean } | null)?.signupSuccess);
  if (user) return <Navigate to={defaultRouteForRole(user.role)} replace />;
  async function submitCredentials(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post<LoginResponse>('/auth/login', { email, password });
      setPendingToken(data.pendingToken);
      if (data.twoFactorConfigured) setStep('totp');
      else {
        const response = await api.post<SetupResponse>('/auth/2fa/setup', undefined, {
          headers: { Authorization: `Bearer ${data.pendingToken}` },
        });
        setSetup(response.data);
        setStep('setup');
      }
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSubmitting(false);
    }
  }
  async function submitCode(event: FormEvent) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const { data } = await api.post<VerifyResponse>(
        '/auth/2fa/verify',
        { code },
        { headers: { Authorization: `Bearer ${pendingToken}` } },
      );
      login(data.token, data.user);
      navigate(defaultRouteForRole(data.user.role), { replace: true });
    } catch (requestError) {
      setError(messageFor(requestError));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <main className="auth-page">
      <div className="auth-form-side">
        <section className="auth-card">
          <img className="auth-brand" src="/images/costflow_logo-Photoroom.png" alt="Cost Flow" />
          {step === 'credentials' && (
            <>
              <h1 className="mt-3 text-3xl font-semibold">Sign in</h1>
              <p className="auth-muted mt-2 text-sm">Welcome back. Please enter your details.</p>
              {signupSuccess && (
                <p role="status" className="mt-4 rounded-lg bg-emerald-950/60 p-3 text-sm text-emerald-300">
                  Account created — log in to continue. You’ll set up two-factor authentication next.
                </p>
              )}
              <form onSubmit={submitCredentials} className="mt-7 space-y-4">
                <Field label="Email" type="email" value={email} onChange={setEmail} />
                <PasswordField
                  value={password}
                  onChange={setPassword}
                  show={showPassword}
                  onToggle={() => setShowPassword((visible) => !visible)}
                />
                {error && <Error text={error} />}
                <Submit busy={submitting} label="Continue" />
              </form>
              <p className="mt-5 text-center text-sm text-slate-400">
                Don&apos;t have an account?{' '}
                <Link to="/signup" className="font-medium text-cyan-300 hover:text-cyan-200">
                  Sign up
                </Link>
              </p>
            </>
          )}
          {step === 'setup' && (
            <>
              <h1 className="mt-3 text-3xl font-semibold">Set up two-factor authentication</h1>
              <p className="mt-2 text-sm text-slate-400">
                Scan this one time QR code, then enter its six-digit code.
              </p>
              {setup && (
                <>
                  <img
                    src={setup.qrCodeDataUrl}
                    alt="Two-factor setup QR code"
                    className="mx-auto mt-5 h-44 w-44 rounded-lg bg-white p-2"
                  />
                  <p className="mt-3 break-all text-xs text-slate-400">Manual key: {setup.manualEntryKey}</p>
                </>
              )}
              <CodeForm
                code={code}
                setCode={setCode}
                onSubmit={submitCode}
                error={error}
                submitting={submitting}
              />
            </>
          )}
          {step === 'totp' && (
            <>
              <h1 className="mt-3 text-3xl font-semibold">Two-factor authentication</h1>
              <p className="mt-2 text-sm text-slate-400">
                Enter the six-digit code from your authenticator app.
              </p>
              <CodeForm
                code={code}
                setCode={setCode}
                onSubmit={submitCode}
                error={error}
                submitting={submitting}
              />
            </>
          )}
        </section>
      </div>
    </main>
  );
}
function Field({
  label,
  type,
  value,
  onChange,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="auth-label block text-sm">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
        required
        className="auth-input mt-1 w-full px-3 py-2.5"
      />
    </label>
  );
}
function PasswordField({
  value,
  onChange,
  show,
  onToggle,
}: {
  value: string;
  onChange: (value: string) => void;
  show: boolean;
  onToggle: () => void;
}) {
  return (
    <label className="auth-label block text-sm">
      Password
      <div className="relative mt-1">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={show ? 'text' : 'password'}
          required
          className="auth-input w-full px-3 py-2.5 pr-16"
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-2 px-2 text-xs font-medium text-cyan-300 hover:text-cyan-200"
        >
          {show ? 'Hide' : 'Show'}
        </button>
      </div>
    </label>
  );
}
function Error({ text }: { text: string }) {
  return (
    <p role="alert" className="auth-error">
      {text}
    </p>
  );
}
function Submit({ busy, label }: { busy: boolean; label: string }) {
  return (
    <button
      disabled={busy}
      className="auth-primary w-full rounded-lg px-4 py-2.5 font-semibold disabled:opacity-60"
    >
      {busy ? 'Working…' : label}
    </button>
  );
}
function CodeForm({
  code,
  setCode,
  onSubmit,
  error,
  submitting,
}: {
  code: string;
  setCode: (code: string) => void;
  onSubmit: (event: FormEvent) => void;
  error: string;
  submitting: boolean;
}) {
  const inputs = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length: 6 }, (_, index) => code[index] ?? '');

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  function setDigit(index: number, value: string) {
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setCode(next.join(''));
    if (digit && index < 5) inputs.current[index + 1]?.focus();
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < 5) {
      event.preventDefault();
      inputs.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    setCode(pasted);
    inputs.current[Math.min(pasted.length, 6) - 1]?.focus();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <label className="auth-label block text-sm">
        Authentication code
        <span className="auth-otp-row mt-2" role="group" aria-label="Six digit authentication code">
          {digits.map((digit, index) => (
            <input
              key={index}
              ref={(element) => {
                inputs.current[index] = element;
              }}
              value={digit}
              onChange={(event) => setDigit(index, event.target.value)}
              onKeyDown={(event) => handleKeyDown(index, event)}
              onPaste={handlePaste}
              inputMode="numeric"
              autoComplete={index === 0 ? 'one-time-code' : 'off'}
              aria-label={`Authentication code digit ${index + 1}`}
              maxLength={1}
              required
              className="auth-otp-input"
            />
          ))}
        </span>
      </label>
      {error && <Error text={error} />}
      <Submit busy={submitting} label="Verify and sign in" />
    </form>
  );
}
