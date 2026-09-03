import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

type AuditEntry = {
  id: string;
  eventType: string;
  targetType: string;
  actorUserId: string | null;
  actorEmail: string | null;
  actorRole: string | null;
  createdAt: string;
};
type AuditResult = { rows: AuditEntry[]; total: number };

export function AuditLog() {
  const [eventType, setEventType] = useState('');
  const [offset, setOffset] = useState(0);
  const result = useQuery({
    queryKey: ['audit-log', eventType, offset],
    queryFn: async () =>
      (
        await api.get<AuditResult>('/audit-log', {
          params: { eventType: eventType || undefined, limit: 50, offset },
        })
      ).data,
  });
  async function exportCsv() {
    const response = await api.post(
      '/audit-log/export',
      { eventType: eventType || undefined },
      { responseType: 'blob' },
    );
    const url = URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'audit-log.csv';
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold">Audit Log</h1>
      <div className="flex gap-3">
        <input
          value={eventType}
          onChange={(event) => {
            setEventType(event.target.value);
            setOffset(0);
          }}
          placeholder="Filter event type"
          className="rounded border border-slate-700 bg-slate-950 px-3 py-2"
        />
        <button onClick={exportCsv} className="rounded border border-cyan-400 px-3 py-2 text-cyan-300">
          Export CSV
        </button>
      </div>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <table className="w-full text-left text-sm">
          <thead className="text-slate-400">
            <tr>
              <th>When</th>
              <th>Event</th>
              <th>Target</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            {result.data?.rows.map((entry) => (
              <tr key={entry.id} className="border-t border-slate-800">
                <td className="py-2">{new Date(entry.createdAt).toLocaleString()}</td>
                <td>{entry.eventType}</td>
                <td>{entry.targetType}</td>
                <td>
                  {entry.actorEmail && entry.actorRole
                    ? `${entry.actorRole.replace('_', ' ')} — ${entry.actorEmail}`
                    : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex gap-3">
          <button disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}>
            Previous
          </button>
          <button disabled={(result.data?.rows.length ?? 0) < 50} onClick={() => setOffset(offset + 50)}>
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
