'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { AdminShell, Panel, AdminEmpty, AdminError, TableSkeleton } from './AdminShell';

/**
 * Roles and admin accounts.
 *
 * A system role (ADMIN, FINANCE, SUPPORT) can be assigned to an admin but
 * never edited or deleted here — the form disables itself for one rather
 * than hiding the row, so it's clear the role exists and is just locked, not
 * that something failed to load. See rbac.service.ts for why: it's what
 * guarantees there's always a way back in after a custom role gets
 * misconfigured.
 */

interface Permission { key: string; label: string; group: string }
interface Role {
  id: string; name: string; description: string | null; permissions: string[]; isSystem: boolean;
  _count: { admins: number };
}
interface AdminAccount {
  id: string; email: string; name: string; totpEnabled: boolean; lastLoginAt: string | null; createdAt: string;
  role: { id: string; name: string };
}

export function RolesAdminView() {
  return (
    <AdminShell title="Roles & admins" subtitle="Who can do what in this console." permission="roles.manage">
      <RolesAndAdmins />
    </AdminShell>
  );
}

function RolesAndAdmins() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [admins, setAdmins] = useState<AdminAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingRole, setEditingRole] = useState<Role | 'new' | null>(null);
  const [creatingAdmin, setCreatingAdmin] = useState(false);

  const load = useCallback(async () => {
    const [p, r, a] = await Promise.all([
      api<Permission[]>('/admin/roles/permissions'),
      api<Role[]>('/admin/roles'),
      api<AdminAccount[]>('/admin/admins'),
    ]);
    setPermissions(p);
    setRoles(r);
    setAdmins(a);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : 'Could not load roles.')).finally(() => setLoading(false));
  }, [load]);

  if (error && roles.length === 0) return <AdminError message={error} />;
  if (loading) return <TableSkeleton rows={5} />;

  const groups = [...new Set(permissions.map((p) => p.group))];

  return (
    <div className="space-y-6">
      <Panel
        title="Roles"
        action={
          !editingRole && (
            <button type="button" onClick={() => setEditingRole('new')} className="text-xs font-semibold text-neutral-700 hover:underline">
              + New role
            </button>
          )
        }
      >
        {editingRole ? (
          <RoleForm
            role={editingRole === 'new' ? null : editingRole}
            groups={groups}
            permissions={permissions}
            onDone={async () => { setEditingRole(null); await load(); }}
            onCancel={() => setEditingRole(null)}
          />
        ) : (
          <div className="space-y-2">
            {roles.map((r) => (
              <div key={r.id} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {r.name}
                    {r.isSystem && <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500">Built in</span>}
                  </p>
                  {r.description && <p className="mt-0.5 text-xs text-neutral-500">{r.description}</p>}
                  <p className="mt-1 text-xs text-neutral-400">{r.permissions.length} permission{r.permissions.length === 1 ? '' : 's'} · {r._count.admins} admin{r._count.admins === 1 ? '' : 's'}</p>
                </div>
                {!r.isSystem && (
                  <div className="flex shrink-0 gap-3 text-xs font-semibold">
                    <button type="button" onClick={() => setEditingRole(r)} className="text-neutral-700 hover:underline">Edit</button>
                    <DeleteRoleButton role={r} onDeleted={load} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Admin accounts"
        action={
          !creatingAdmin && (
            <button type="button" onClick={() => setCreatingAdmin(true)} className="text-xs font-semibold text-neutral-700 hover:underline">
              + New admin
            </button>
          )
        }
      >
        {creatingAdmin ? (
          <AdminAccountForm roles={roles} onDone={async () => { setCreatingAdmin(false); await load(); }} onCancel={() => setCreatingAdmin(false)} />
        ) : admins.length === 0 ? (
          <AdminEmpty>No admin accounts.</AdminEmpty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wider text-neutral-500">
                <tr>
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Email</th>
                  <th className="py-2 pr-4">Role</th>
                  <th className="py-2 pr-4">2FA</th>
                  <th className="py-2 pr-4">Last login</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {admins.map((a) => (
                  <AdminAccountRow key={a.id} admin={a} roles={roles} onChanged={load} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- role form */

function RoleForm({
  role, groups, permissions, onDone, onCancel,
}: {
  role: Role | null; groups: string[]; permissions: Permission[]; onDone: () => Promise<void>; onCancel: () => void;
}) {
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const save = async () => {
    if (saving || name.trim().length < 2) return;
    setSaving(true);
    setError(null);
    try {
      const body = { name: name.trim(), description: description.trim() || undefined, permissions: [...selected] };
      if (role) await api(`/admin/roles/${role.id}`, { method: 'PUT', body });
      else await api('/admin/roles', { method: 'POST', body });
      await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the role.');
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-medium text-neutral-800">
          Role name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Description (optional)
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
        </label>
      </div>

      <div className="space-y-4">
        {groups.map((g) => (
          <div key={g}>
            <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{g}</p>
            <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
              {permissions.filter((p) => p.group === g).map((p) => (
                <label key={p.key} className="flex items-center gap-2 text-sm text-neutral-700">
                  <input type="checkbox" checked={selected.has(p.key)} onChange={() => toggle(p.key)} className="rounded border-neutral-300" />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving || name.trim().length < 2} className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300">
          {saving ? 'Saving…' : 'Save role'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100">
          Cancel
        </button>
      </div>
    </div>
  );
}

function DeleteRoleButton({ role, onDeleted }: { role: Role; onDeleted: () => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (confirming) {
    return (
      <span className="flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try { await api(`/admin/roles/${role.id}/delete`, { method: 'POST', body: {} }); await onDeleted(); }
            catch (err) { setError(err instanceof ApiError ? err.message : 'Could not delete.'); setBusy(false); setConfirming(false); }
          }}
          className="text-red-700 hover:underline"
        >
          Confirm delete
        </button>
        <button type="button" onClick={() => setConfirming(false)} className="text-neutral-500 hover:underline">Cancel</button>
      </span>
    );
  }
  return (
    <>
      <button type="button" onClick={() => setConfirming(true)} className="text-red-700 hover:underline">Delete</button>
      {error && <span className="text-red-700">{error}</span>}
    </>
  );
}

/* ------------------------------------------------------------- admin form */

function AdminAccountForm({
  roles, onDone, onCancel,
}: {
  roles: Role[]; onDone: () => Promise<void>; onCancel: () => void;
}) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleId, setRoleId] = useState(roles[0]?.id ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdPassword, setCreatedPassword] = useState<string | null>(null);

  const save = async () => {
    if (saving || !email.trim() || name.trim().length < 2 || !roleId) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ temporaryPassword?: string }>('/admin/admins', {
        method: 'POST',
        body: { email: email.trim(), name: name.trim(), roleId },
      });
      if (result.temporaryPassword) setCreatedPassword(result.temporaryPassword);
      else await onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the admin.');
      setSaving(false);
    }
  };

  if (createdPassword) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">
        <p className="font-semibold text-amber-900">Account created. This password is shown once — share it now:</p>
        <p className="mt-2 select-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-neutral-900">{createdPassword}</p>
        <button type="button" onClick={onDone} className="mt-3 rounded-lg bg-neutral-900 px-4 py-2 text-xs font-semibold text-white">
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block text-sm font-medium text-neutral-800">
          Name
          <input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none" />
        </label>
        <label className="block text-sm font-medium text-neutral-800">
          Role
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="mt-1.5 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:border-neutral-900 focus:outline-none">
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </label>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-semibold text-white disabled:bg-neutral-300">
          {saving ? 'Creating…' : 'Create admin'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-neutral-300 px-5 py-2.5 text-sm font-semibold text-neutral-700 hover:bg-neutral-100">
          Cancel
        </button>
      </div>
    </div>
  );
}

function AdminAccountRow({ admin, roles, onChanged }: { admin: AdminAccount; roles: Role[]; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const changeRole = async (roleId: string) => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/admins/${admin.id}/role`, { method: 'PUT', body: { roleId } });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change role.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr>
      <td className="py-2 pr-4 text-neutral-900">{admin.name}</td>
      <td className="py-2 pr-4 text-neutral-600">{admin.email}</td>
      <td className="py-2 pr-4">
        <select
          value={admin.role.id}
          onChange={(e) => changeRole(e.target.value)}
          disabled={busy}
          className="rounded-lg border border-neutral-300 px-2 py-1 text-xs focus:border-neutral-900 focus:outline-none"
        >
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </td>
      <td className="py-2 pr-4 text-neutral-500">{admin.totpEnabled ? 'On' : '—'}</td>
      <td className="py-2 pr-4 text-neutral-500">{admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleDateString('en-IN') : 'Never'}</td>
      <td className="py-2" />
    </tr>
  );
}
