import axios from 'axios';
import { type FormEvent, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { defaultRouteForRole } from '../config/navigation';
import { useAuthStore } from '../store/authStore';

type SignupResponse = { orgId: string; userId: string; email: string };

function errorMessage(error: unknown) {
  if (!axios.isAxiosError(error)) return 'Unable to create your account. Please try again.';
  const message = error.response?.data?.error;
  if (message === 'An account with this email already exists') return 'An account with this email already exists.';
  return message ?? 'Unable to create your account. Please try again.';
}

export function Signup() {
  const user = useAuthStore((state) => state.user);
  const navigate = useNavigate();
  const [orgName, setOrgName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (user) return <Navigate replace to={defaultRouteForRole(user.role)} />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post<SignupResponse>('/auth/signup', { orgName, email, password });
      navigate('/login', { replace: true, state: { signupSuccess: true, email } });
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="auth-form-side">
      <section className="auth-card">
        <img className="auth-brand" src="/images/costflow_logo-Photoroom.png" alt="Cost Flow" />
        <h1 className="mt-3 text-3xl font-semibold">Create your workspace</h1>
        <p className="auth-muted mt-2 text-sm">Set up your organization and its first Org Admin account.</p>
        <form onSubmit={submit} className="mt-7 space-y-4">
          <label className="auth-label block text-sm">Organization name<input required value={orgName} onChange={(event) => setOrgName(event.target.value)} className="auth-input mt-1 w-full px-3 py-2.5" /></label>
          <label className="auth-label block text-sm">Admin email<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className="auth-input mt-1 w-full px-3 py-2.5" /></label>
          <label className="auth-label block text-sm">Password<div className="relative mt-1"><input required minLength={8} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} className="auth-input w-full px-3 py-2.5 pr-16" /><button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-2 px-2 text-xs font-medium text-cyan-300">{showPassword ? 'Hide' : 'Show'}</button></div></label>
          <label className="auth-label block text-sm">Confirm password<input required minLength={8} type={showPassword ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="auth-input mt-1 w-full px-3 py-2.5" /></label>
          {error && <p role="alert" className="rounded-lg bg-red-950/60 p-3 text-sm text-red-300">{error}</p>}
          <button disabled={submitting} className="auth-primary w-full rounded-lg px-4 py-2.5 font-semibold disabled:opacity-60">{submitting ? 'Creating account…' : 'Create account'}</button>
        </form>
        <p className="mt-5 text-center text-sm text-slate-400">Already have an account? <Link to="/login" className="font-medium text-cyan-300 hover:text-cyan-200">Log in</Link></p>
      </section>
      </div>
    </main>
  );
}
