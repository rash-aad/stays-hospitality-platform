'use client';

import { useState } from 'react';
import { useMe } from '@/components/admin-context';
import { Drawer, ErrorNote, Field, Loading, PageHeader, Section, Status, Tabs, cx, useAction } from '@/components/ui';
import { staffApi } from '@/lib/api';
import { ago } from '@/lib/format';
import { useStaff } from '@/lib/hooks';

type Staff = { id: string; name: string; email: string; status: string; lastLoginAt: string | null; roles: { id: string; key: string; name: string }[] };
type Role = { id: string; key: string; name: string; isSystem: boolean; permissions: string[] };

export default function StaffPage() {
  const me = useMe();
  const [tab, setTab] = useState<'people' | 'roles'>('people');
  const { data: people, error, mutate } = useStaff<{ data: Staff[] }>('/admin/staff?pageSize=200');
  const { data: roles, mutate: mr } = useStaff<{ data: Role[]; catalog: { key: string; description: string }[] }>('/admin/roles');
  const [edit, setEdit] = useState<{ id?: string; name: string; email: string; roleIds: string[]; status?: string } | null>(null);
  const [role, setRole] = useState<{ id?: string; name: string; permissions: string[]; isSystem?: boolean; key?: string } | null>(null);
  const { busy, run } = useAction();
  return (
    <>
      <PageHeader title="Staff & roles" actions={tab === 'people' ? <button className="btn btn-primary" onClick={() => setEdit({ name: '', email: '', roleIds: [] })}>Invite staff</button> : <button className="btn btn-primary" onClick={() => setRole({ name: '', permissions: [] })}>New role</button>}>
        <Tabs value={tab} onChange={setTab} items={[{ value: 'people', label: 'People' }, { value: 'roles', label: 'Roles & permissions' }]} />
      </PageHeader>
      <ErrorNote error={error} />
      {tab === 'people' ? (!people ? <Loading /> : (
        <div className="bg-panel">
          <table className="tbl">
            <thead><tr><th>Name</th><th>Roles</th><th>Status</th><th>Last sign-in</th></tr></thead>
            <tbody>{people.data.map((u) => (
              <tr key={u.id} className="is-link" onClick={() => setEdit({ id: u.id, name: u.name, email: u.email, roleIds: u.roles.map((r) => r.id), status: u.status })}>
                <td><p className="font-medium">{u.name}{u.id === me.user.id && <span className="text-muted"> (you)</span>}</p><p className="text-xs text-muted">{u.email}</p></td>
                <td>{u.roles.map((r) => r.name).join(', ')}</td>
                <td><Status value={u.status} /></td>
                <td className="text-muted">{u.lastLoginAt ? ago(u.lastLoginAt) : 'Never'}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )) : !roles ? <Loading /> : (
        <div className="overflow-x-auto bg-panel">
          <table className="tbl">
            <thead><tr><th className="min-w-64">Permission</th>{roles.data.map((r) => <th key={r.id} className="text-center"><button className="hover:underline" onClick={() => setRole({ ...r })}>{r.name}</button></th>)}</tr></thead>
            <tbody>{roles.catalog.map((p) => (
              <tr key={p.key}><td><p className="text-[13px]">{p.description}</p><p className="font-mono text-2xs text-faint">{p.key}</p></td>
                {roles.data.map((r) => <td key={r.id} className="text-center">{r.key === 'owner' || r.permissions.includes(p.key) ? '●' : <span className="text-line-strong">·</span>}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Drawer open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? edit.name : 'Invite a team member'} sub={!edit?.id && 'They’ll get an email to set their password.'}
        footer={edit && <>
          {edit.id && edit.id !== me.user.id && <button className="btn btn-danger mr-auto" disabled={busy} onClick={() => run(() => staffApi(`/admin/staff/${edit.id}`, { method: 'PATCH', body: { status: edit.status === 'disabled' ? 'active' : 'disabled' } }), edit.status === 'disabled' ? 'Access restored' : 'Access removed').then(() => { setEdit(null); mutate(); })}>{edit.status === 'disabled' ? 'Restore access' : 'Remove access'}</button>}
          <button className="btn btn-primary" disabled={busy || !edit.name || !edit.roleIds.length} onClick={() => run(() => edit.id ? staffApi(`/admin/staff/${edit.id}`, { method: 'PATCH', body: { name: edit.name, ...(edit.id !== me.user.id ? { roleIds: edit.roleIds } : {}) } }) : staffApi('/admin/staff', { body: { name: edit.name, email: edit.email, roleIds: edit.roleIds } }), edit.id ? 'Saved' : 'Invitation sent').then((r) => { if (r !== undefined) { setEdit(null); mutate(); } })}>{edit.id ? 'Save' : 'Send invite'}</button>
        </>}>
        {edit && (
          <Section>
            <Field label="Name"><input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            {!edit.id && <Field label="Email" className="mt-3"><input className="input" type="email" value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>}
            <p className="label mt-4">Roles</p>
            {edit.id === me.user.id && <p className="hint mb-2">You can’t change your own roles.</p>}
            <ul className="divide-y divide-line border-y border-line">
              {roles?.data.map((r) => (
                <li key={r.id}><label className={cx('flex items-center justify-between gap-3 py-2 text-[13px]', edit.id === me.user.id && 'opacity-60')}>
                  <span className="flex items-center gap-2"><input type="checkbox" disabled={edit.id === me.user.id || (r.key === 'owner' && !me.isOwner)} checked={edit.roleIds.includes(r.id)} onChange={(e) => setEdit({ ...edit, roleIds: e.target.checked ? [...edit.roleIds, r.id] : edit.roleIds.filter((x) => x !== r.id) })} />{r.name}</span>
                  <span className="text-xs text-muted">{r.key === 'owner' ? 'Everything' : `${r.permissions.length} permissions`}</span>
                </label></li>
              ))}
            </ul>
          </Section>
        )}
      </Drawer>
      <Drawer open={!!role} onClose={() => setRole(null)} title={role?.id ? role.name : 'New role'}
        footer={role && role.key !== 'owner' && <button className="btn btn-primary" disabled={busy || !role.name} onClick={() => run(() => role.id ? staffApi(`/admin/roles/${role.id}`, { method: 'PUT', body: { name: role.name, permissions: role.permissions } }) : staffApi('/admin/roles', { body: { name: role.name, permissions: role.permissions } }), 'Role saved').then((r) => { if (r !== undefined) { setRole(null); mr(); } })}>Save role</button>}>
        {role && (
          <Section>
            <Field label="Role name"><input className="input" disabled={role.key === 'owner'} value={role.name} onChange={(e) => setRole({ ...role, name: e.target.value })} /></Field>
            {role.key === 'owner' ? <p className="mt-4 text-[13px] text-muted">Owners always have every permission.</p> : (
              <ul className="mt-4 divide-y divide-line border-y border-line">
                {roles?.catalog.map((p) => (
                  <li key={p.key}><label className="flex items-start gap-2 py-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={role.permissions.includes(p.key)} onChange={(e) => setRole({ ...role, permissions: e.target.checked ? [...role.permissions, p.key] : role.permissions.filter((x) => x !== p.key) })} /><span>{p.description}<span className="block font-mono text-2xs text-faint">{p.key}</span></span></label></li>
                ))}
              </ul>
            )}
          </Section>
        )}
      </Drawer>
    </>
  );
}
