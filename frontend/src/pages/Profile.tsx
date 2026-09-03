import axios from 'axios';
import { type FormEvent, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';

type ProfileData = { id: string; email: string; role: string; orgId: string | null; orgName: string };
const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';

export function Profile() {
  const logout = useAuthStore((state) => state.logout);
  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: async () => (await api.get<ProfileData>('/auth/me')).data,
  });
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const [success, setSuccess] = useState('');
  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setSuccess(
        'Password changed. Your current session has been signed out for security; please sign in again.',
      );
      setTimeout(() => {
        logout();
        window.location.assign('/login');
      }, 1200);
    },
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setLocalError('');
    setSuccess('');
    if (newPassword !== confirmPassword) {
      setLocalError('New password and confirmation do not match.');
      return;
    }
    changePassword.mutate();
  };
  return (
    <div className="space-y-7">
      <section>
        <h1 className="text-3xl font-semibold">Profile</h1>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Account details</h2>
        {profile.isLoading ? (
          <p className="mt-3 text-sm text-slate-400">Loading profile…</p>
        ) : (
          profile.data && (
            <dl className="mt-4 grid gap-4 text-sm md:grid-cols-3">
              <div>
                <dt className="text-slate-400">Email</dt>
                <dd className="mt-1 font-medium">{profile.data.email}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Role</dt>
                <dd className="mt-1 capitalize">{profile.data.role.replace('_', ' ')}</dd>
              </div>
              <div>
                <dt className="text-slate-400">Organization</dt>
                <dd className="mt-1">{profile.data.orgName}</dd>
              </div>
            </dl>
          )
        )}
      </section>
      <section className="max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Change password</h2>
        <form onSubmit={submit} className="mt-4 space-y-4">
          <label className="block text-sm">
            Current password
            <input
              required
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            New password
            <input
              required
              minLength={8}
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            Confirm new password
            <input
              required
              minLength={8}
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
          </label>
          <button
            disabled={changePassword.isPending}
            className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
          >
            Change password
          </button>
        </form>
        {(localError || changePassword.isError) && (
          <p className="mt-3 text-sm text-red-300">{localError || errorMessage(changePassword.error)}</p>
        )}
        {success && <p className="mt-3 text-sm text-emerald-300">{success}</p>}
      </section>
    </div>
  );
}
