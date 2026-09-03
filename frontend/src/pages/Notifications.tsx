import axios from 'axios';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { Notification } from '../types/resources';

const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';
export function Notifications() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const notifications = useQuery({
    queryKey: ['notifications', user?.id, unreadOnly],
    queryFn: async () =>
      (
        await api.get<Notification[]>('/notifications', {
          params: unreadOnly ? { unreadOnly: true } : {},
        })
      ).data,
  });
  const markRead = useMutation({
    mutationFn: async (id: string) => api.patch(`/notifications/${id}`, { read: true }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications', user?.id, 'unread-count'] });
    },
  });
  const openNotification = (item: Notification) => {
    const destination = item.eventType === 'budget_alert_triggered' ? '/alerts' : '/notifications';
    if (item.read) {
      navigate(destination);
      return;
    }
    markRead.mutate(item.id, { onSuccess: () => navigate(destination) });
  };
  return (
    <div className="space-y-6">
      <section>
        <h1 className="mt-1 text-3xl font-semibold">Notifications</h1>
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <label className="flex w-fit items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(event) => setUnreadOnly(event.target.checked)}
          />{' '}
          Unread only
        </label>
        <div className="mt-4 space-y-3">
          {notifications.data?.map((item) => (
            <article
              key={item.id}
              onClick={() => openNotification(item)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') openNotification(item);
              }}
              role="link"
              tabIndex={0}
              className={`rounded-xl border p-4 ${item.read ? 'border-slate-800 bg-slate-950/40' : 'border-cyan-500/40 bg-cyan-950/20'}`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-medium">{item.message}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {item.severity} - {item.priority} - {new Date(item.createdAt).toLocaleString()}
                  </p>
                </div>
                {!item.read && (
                  <button
                    disabled={markRead.isPending}
                    onClick={(event) => {
                      event.stopPropagation();
                      markRead.mutate(item.id);
                    }}
                    className="rounded-md border border-cyan-400 px-3 py-1 text-sm text-cyan-300"
                  >
                    Mark read
                  </button>
                )}
              </div>
            </article>
          ))}
          {!notifications.isLoading && !notifications.data?.length && (
            <p className="text-sm text-slate-400">No notifications to show.</p>
          )}
        </div>
        {markRead.isError && (
          <p role="alert" className="auth-error mt-3">
            {errorMessage(markRead.error)}
          </p>
        )}
      </section>
    </div>
  );
}
