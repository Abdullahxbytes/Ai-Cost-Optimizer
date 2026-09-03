import axios from 'axios';
import { type FormEvent, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import { useAuthStore } from '../store/authStore';
import type { Team } from '../types/resources';

type OrganizationUser = { id: string; email: string; role: string; active: boolean };
type TeamMember = { id: string; email: string; role: string; createdAt: string };
const errorMessage = (error: unknown) =>
  axios.isAxiosError(error) ? (error.response?.data?.error ?? 'Request failed') : 'Request failed';

export function Teams() {
  const user = useAuthStore((state) => state.user)!;
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [leadId, setLeadId] = useState('');
  const [parentId, setParentId] = useState('');
  const [edit, setEdit] = useState<Team | null>(null);
  const [editName, setEditName] = useState('');
  const [editLeadId, setEditLeadId] = useState('');
  const [membersTeam, setMembersTeam] = useState<Team | null>(null);
  const [memberId, setMemberId] = useState('');
  const [deleting, setDeleting] = useState<Team | null>(null);
  const [deleteMode, setDeleteMode] = useState<'purge_now' | 'archive_15_days'>('archive_15_days');
  const teams = useQuery({
    queryKey: ['teams'],
    queryFn: async () => (await api.get<Team[]>('/teams')).data,
  });
  const users = useQuery({
    queryKey: ['org-users', user.orgId],
    queryFn: async () => (await api.get<OrganizationUser[]>(`/orgs/${user.orgId}/users`)).data,
    enabled: user.role === 'org_admin',
  });
  const topLevelTeams = useMemo(() => (teams.data ?? []).filter((team) => !team.parentTeamId), [teams.data]);
  const refresh = () => void client.invalidateQueries({ queryKey: ['teams'] });
  const create = useMutation({
    mutationFn: () => api.post('/teams', { name, ...(leadId && { teamLeadId: leadId }) }),
    onSuccess: () => {
      setName('');
      setLeadId('');
      refresh();
    },
  });
  const subTeam = useMutation({
    mutationFn: () =>
      api.post(`/teams/${parentId}/sub-teams`, { name, ...(leadId && { teamLeadId: leadId }) }),
    onSuccess: () => {
      setName('');
      setLeadId('');
      setParentId('');
      refresh();
    },
  });
  const update = useMutation({
    mutationFn: () =>
      api.patch(`/teams/${edit!.id}`, { name: editName, ...(editLeadId && { teamLeadId: editLeadId }) }),
    onSuccess: () => {
      setEdit(null);
      refresh();
    },
  });
  const members = useQuery({
    queryKey: ['team-members', membersTeam?.id],
    enabled: Boolean(membersTeam),
    queryFn: async () => (await api.get<TeamMember[]>(`/teams/${membersTeam!.id}/members`)).data,
  });
  const availableDevelopers = useQuery({
    queryKey: ['team-developers', membersTeam?.id],
    enabled: Boolean(membersTeam),
    queryFn: async () =>
      (await api.get<OrganizationUser[]>(`/teams/${membersTeam!.id}/available-developers`)).data,
  });
  const addMember = useMutation({
    mutationFn: () => api.post(`/teams/${membersTeam!.id}/members`, { userId: memberId }),
    onSuccess: () => {
      setMemberId('');
      void client.invalidateQueries({ queryKey: ['team-members', membersTeam?.id] });
    },
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => api.delete(`/teams/${membersTeam!.id}/members/${userId}`),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['team-members', membersTeam?.id] }),
  });
  const removeTeam = useMutation({
    mutationFn: () => api.post(`/teams/${deleting!.id}/deletion`, { mode: deleteMode }),
    onSuccess: () => {
      setDeleting(null);
      refresh();
    },
  });
  const submitTopLevel = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };
  const submitSubTeam = (event: FormEvent) => {
    event.preventDefault();
    subTeam.mutate();
  };
  return (
    <div className="space-y-7">
      <section>
        <h1 className="text-3xl font-semibold">Teams</h1>
      </section>
      {user.role === 'org_admin' && (
        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="text-lg font-semibold">Create top-level team</h2>
          <form onSubmit={submitTopLevel} className="mt-4 flex flex-wrap gap-3">
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Team name"
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">Use me as lead</option>
              {users.data
                ?.filter((member) => member.active)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.email} ({member.role})
                  </option>
                ))}
            </select>
            <button
              disabled={create.isPending}
              className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950"
            >
              Create team
            </button>
          </form>
          {create.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(create.error)}</p>}
        </section>
      )}
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Create sub-team</h2>
        <p className="mt-1 text-sm text-slate-400">
          Sub-teams can only be created under a top-level team. Nested sub-teams are not allowed.
        </p>
        <form onSubmit={submitSubTeam} className="mt-4 flex flex-wrap gap-3">
          <select
            required
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          >
            <option value="">Choose a top-level parent</option>
            {topLevelTeams.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sub-team name"
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
          />
          {user.role === 'org_admin' && (
            <select
              value={leadId}
              onChange={(e) => setLeadId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">Use me as lead</option>
              {users.data
                ?.filter((member) => member.active)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.email}
                  </option>
                ))}
            </select>
          )}
          <button
            disabled={subTeam.isPending || !parentId}
            className="rounded-lg border border-cyan-400 px-4 py-2 text-cyan-300 disabled:opacity-50"
          >
            Create sub-team
          </button>
        </form>
        {subTeam.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(subTeam.error)}</p>}
      </section>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
        <h2 className="text-lg font-semibold">Visible teams</h2>
        {teams.isLoading ? (
          <p className="mt-4 text-sm text-slate-400">Loading teams…</p>
        ) : (
          <div className="mt-4 divide-y divide-slate-800">
            {teams.data?.map((team) => (
              <div key={team.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div>
                  <p className="font-medium">
                    {team.parentTeamId ? '↳ ' : ''}
                    {team.name}
                  </p>
                  <p className="text-sm text-slate-400">Lead: {team.teamLeadEmail ?? 'Unassigned'}</p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setMembersTeam(team)}
                    className="rounded border border-slate-700 px-3 py-1 text-sm"
                  >
                    Developers
                  </button>
                  {user.role === 'org_admin' && (
                    <>
                      <button
                        onClick={() => {
                          setEdit(team);
                          setEditName(team.name);
                          setEditLeadId(team.teamLeadId ?? '');
                        }}
                        className="rounded border border-slate-700 px-3 py-1 text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleting(team)}
                        className="rounded border border-red-500/70 px-3 py-1 text-sm text-red-300"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      {membersTeam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">Developers — {membersTeam.name}</h2>
            <p className="mt-1 text-sm text-slate-400">
              Members can access this team and register agents in it.
            </p>
            <div className="mt-4 flex gap-2">
              <select
                value={memberId}
                onChange={(event) => setMemberId(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
              >
                <option value="">Choose a developer</option>
                {availableDevelopers.data?.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.email}
                  </option>
                ))}
              </select>
              <button
                disabled={!memberId || addMember.isPending}
                onClick={() => addMember.mutate()}
                className="rounded bg-cyan-500 px-3 py-2 font-semibold text-slate-950"
              >
                Add
              </button>
            </div>
            <div className="mt-4 space-y-2">
              {members.data?.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded border border-slate-800 p-3"
                >
                  <span>{member.email}</span>
                  <button onClick={() => removeMember.mutate(member.id)} className="text-sm text-red-300">
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => setMembersTeam(null)}
              className="mt-5 rounded border border-slate-700 px-4 py-2"
            >
              Close
            </button>
            {(addMember.isError || removeMember.isError) && (
              <p className="mt-3 text-sm text-red-300">
                {errorMessage(addMember.error ?? removeMember.error)}
              </p>
            )}
          </section>
        </div>
      )}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-red-500/60 bg-slate-900 p-6">
            <h2 className="text-xl font-semibold">Delete {deleting.name}</h2>
            <p className="team-deletion-warning mt-3 text-sm">
              Direct sub-teams remain active as independent top-level teams. This cannot be undone.
            </p>
            <label className="mt-4 flex gap-2">
              <input
                type="radio"
                checked={deleteMode === 'archive_15_days'}
                onChange={() => setDeleteMode('archive_15_days')}
              />{' '}
              Archive for 15 days — data becomes read-only for Org Admin, Finance, and Auditor, then is
              purged.
            </label>
            <label className="mt-3 flex gap-2">
              <input
                type="radio"
                checked={deleteMode === 'purge_now'}
                onChange={() => setDeleteMode('purge_now')}
              />{' '}
              Delete all direct-team agents and data now.
            </label>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => removeTeam.mutate()}
                disabled={removeTeam.isPending}
                className="rounded border border-red-500 px-4 py-2 text-red-300"
              >
                Confirm deletion
              </button>
              <button onClick={() => setDeleting(null)} className="rounded border border-slate-700 px-4 py-2">
                Close
              </button>
            </div>
            {removeTeam.isError && (
              <p className="mt-3 text-sm text-red-300">{errorMessage(removeTeam.error)}</p>
            )}
          </section>
        </div>
      )}
      {edit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              update.mutate();
            }}
            className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6"
          >
            <h2 className="text-lg font-semibold">Edit team</h2>
            <input
              required
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="mt-4 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            />
            <select
              value={editLeadId}
              onChange={(e) => setEditLeadId(e.target.value)}
              className="mt-3 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            >
              <option value="">Keep current lead</option>
              {users.data
                ?.filter((member) => member.active)
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.email}
                  </option>
                ))}
            </select>
            <div className="mt-5 flex gap-3">
              <button className="rounded-lg bg-cyan-500 px-4 py-2 font-semibold text-slate-950">Save</button>
              <button
                type="button"
                onClick={() => setEdit(null)}
                className="rounded-lg border border-slate-700 px-4 py-2"
              >
                Close
              </button>
            </div>
            {update.isError && <p className="mt-3 text-sm text-red-300">{errorMessage(update.error)}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
