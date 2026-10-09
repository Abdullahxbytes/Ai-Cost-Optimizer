import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import axios from 'axios';
import { api } from '../api/client';
import type { Agent } from '../types/resources';

const columns = createColumnHelper<Agent>();
const shortId = (value: string | null) => (value ? `${value.slice(0, 8)}...` : '-');
const initials = (value: string) =>
  value
    .split(/[@._\s-]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
const statusClass = (agent: Agent) =>
  agent.status === 'pending_approval' && agent.approvalStatus === 'rejected'
    ? 'status-rejected'
    : `status-${agent.status.replaceAll('_', '-')}`;
const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';

export function AgentTable({
  agents,
  canApprove,
  onRequestDeletion,
  onConfigureOptimization,
}: {
  agents: Agent[];
  canApprove?: boolean;
  onRequestDeletion?: (agent: Agent) => void;
  onConfigureOptimization?: (agent: Agent) => void;
}) {
  const queryClient = useQueryClient();
  const action = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: 'pause' | 'resume' | 'approve' | 'reject' }) =>
      api.post(`/agents/${id}/${action}`, action === 'reject' ? {} : undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agents'] }),
  });
  const table = useReactTable({
    data: agents,
    getCoreRowModel: getCoreRowModel(),
    columns: [
      columns.accessor('name', {
        header: 'Name',
        cell: (info) => <span className="agent-table-name">{info.getValue()}</span>,
      }),
      columns.accessor('status', {
        header: 'Status',
        cell: (info) => {
          const agent = info.row.original;
          return (
            <span className={`status-pill ${statusClass(agent)}`}>
              {agent.status === 'pending_approval' && agent.approvalStatus === 'rejected'
                ? 'Rejected'
                : info.getValue().replace('_', ' ')}
            </span>
          );
        },
      }),
      columns.accessor('teamName', {
        header: 'Team',
        cell: (info) => info.getValue() ?? shortId(info.row.original.teamId),
      }),
      columns.accessor('ownerEmail', {
        header: 'Owner',
        cell: (info) => {
          const email = info.getValue();
          return email ? (
            <span className="identity">
              <span className="identity-avatar">{initials(email)}</span>
              {email}
            </span>
          ) : (
            shortId(info.row.original.ownerUserId)
          );
        },
      }),
      columns.display({
        id: 'actions',
        header: 'Actions',
        cell: ({ row }) => {
          const agent = row.original;
          if (agent.status === 'active' || agent.status === 'paused') {
            return (
              <span className="flex gap-2">
                <ActionButton
                  busy={action.isPending}
                  label={agent.status === 'active' ? 'Pause' : 'Resume'}
                  onClick={() =>
                    action.mutate({ id: agent.id, action: agent.status === 'active' ? 'pause' : 'resume' })
                  }
                />
                {agent.status === 'active' && onRequestDeletion && (
                  <ActionButton
                    busy={false}
                    label="Request deletion"
                    onClick={() => onRequestDeletion(agent)}
                  />
                )}
              </span>
            );
          }
          if (agent.status === 'pending_approval' && agent.approvalStatus === 'pending' && canApprove) {
            return (
              <span className="flex gap-2">
                <ActionButton
                  busy={action.isPending}
                  label="Approve"
                  onClick={() => action.mutate({ id: agent.id, action: 'approve' })}
                />
                <ActionButton
                  busy={action.isPending}
                  label="Reject"
                  onClick={() => action.mutate({ id: agent.id, action: 'reject' })}
                />
              </span>
            );
          }
          return '-';
        },
      }),
      ...(onConfigureOptimization
        ? [
            columns.display({
              id: 'optimization',
              header: 'Optimization',
              cell: ({ row }) => (
                <ActionButton
                  busy={false}
                  label="Settings"
                  onClick={() => onConfigureOptimization(row.original)}
                />
              ),
            }),
          ]
        : []),
    ],
  });
  return (
    <>
      {agents.length ? (
        <div className="overflow-x-auto">
          <table className="agent-table w-full text-left text-sm">
            <thead className="border-b border-slate-800 text-slate-400">
              {table.getHeaderGroups().map((group) => (
                <tr key={group.id}>
                  {group.headers.map((header) => (
                    <th key={header.id} className="px-3 py-2 font-medium">
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-slate-800/70">
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-3 py-3">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-slate-400">No agents are visible in this scope.</p>
      )}
      {action.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(action.error)}</p>}
    </>
  );
}

function ActionButton({ label, busy, onClick }: { label: string; busy: boolean; onClick: () => void }) {
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className="rounded-md border border-slate-700 px-3 py-1 text-xs disabled:opacity-50"
    >
      {label}
    </button>
  );
}
