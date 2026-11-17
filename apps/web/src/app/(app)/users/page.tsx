'use client';

import {
  type MemberDto,
  PasswordSchema,
  ROLE_CODES,
  ROLE_NAMES,
  type RoleCode,
  type StoreDto,
} from '@kavach/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Field,
  Input,
  ListState,
  Modal,
  PageHeader,
  Select,
  Table,
  Td,
} from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';

function StorePicker({
  stores,
  value,
  onChange,
}: {
  stores: StoreDto[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm font-medium">Stores this person operates</legend>
      {stores
        .filter((s) => s.isActive || value.includes(s.id))
        .map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4"
              checked={value.includes(s.id)}
              onChange={(e) =>
                onChange(e.target.checked ? [...value, s.id] : value.filter((id) => id !== s.id))
              }
            />
            {s.name}
          </label>
        ))}
    </fieldset>
  );
}

function UserForm({
  member,
  stores,
  onClose,
}: {
  member: MemberDto | null;
  stores: StoreDto[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { me } = useSession();
  const isSelf = member?.userId === me?.user.id;
  const [name, setName] = useState(member?.name ?? '');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [roleCode, setRoleCode] = useState<RoleCode>(member?.roleCode ?? 'STORE_MANAGER');
  const [storeIds, setStoreIds] = useState<string[]>(
    member?.storeIds ?? (stores.length === 1 ? [stores[0]!.id] : []),
  );
  const [password, setPassword] = useState('');

  const save = useMutation({
    mutationFn: () =>
      member
        ? api.users.update(member.userId, {
            name: name !== member.name ? name : undefined,
            roleCode: isSelf ? undefined : roleCode,
            storeIds: roleCode === 'STORE_MANAGER' ? storeIds : undefined,
          })
        : api.users.create({ name, email, phone, roleCode, storeIds, password }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });

  return (
    <Modal title={member ? `Edit ${member.name}` : 'New user'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Full name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
            />
          )}
        </Field>
        {!member && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="E-mail">
                {(id) => (
                  <Input
                    id={id}
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Mobile number">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                )}
              </Field>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">
              Enter at least one. The person signs in with either.
            </p>
          </>
        )}
        <Field label="Role" hint={isSelf ? 'You cannot change your own role.' : undefined}>
          {(id) => (
            <Select
              id={id}
              value={roleCode}
              onChange={(e) => setRoleCode(e.target.value as RoleCode)}
              disabled={isSelf}
            >
              {ROLE_CODES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_NAMES[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {roleCode === 'STORE_MANAGER' ? (
          <StorePicker stores={stores} value={storeIds} onChange={setStoreIds} />
        ) : (
          <p className="text-sm text-muted-foreground">A Project Admin sees every store.</p>
        )}
        {!member && (
          <Field
            label="Initial password"
            hint="At least 8 characters with a letter and a number. The person must change it at first sign-in."
          >
            {(id) => (
              <Input
                id={id}
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            )}
          </Field>
        )}
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {member ? 'Save changes' : 'Create user'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResetPasswordForm({ member, onClose }: { member: MemberDto; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [local, setLocal] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => api.users.resetPassword(member.userId, password),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
  });
  return (
    <Modal title={`Reset password for ${member.name}`} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          const check = PasswordSchema.safeParse(password);
          if (!check.success)
            return setLocal(check.error.issues[0]?.message ?? 'Password is too weak.');
          setLocal(null);
          save.mutate();
        }}
      >
        <p className="text-sm text-muted-foreground">
          {member.name} is signed out everywhere and must choose a new password at next sign-in.
          Give them this temporary password in person.
        </p>
        <Field label="Temporary password">
          {(id) => (
            <Input
              id={id}
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoFocus
            />
          )}
        </Field>
        {(local || save.error) && <Alert>{local ?? errorMessage(save.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={save.isPending}>
            Reset password
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const { me } = useSession();
  const [editing, setEditing] = useState<MemberDto | 'new' | null>(null);
  const [resetting, setResetting] = useState<MemberDto | null>(null);
  const list = useQuery({ queryKey: ['users'], queryFn: api.users.list });
  const stores = useQuery({ queryKey: ['stores'], queryFn: api.stores.list });
  const setStatus = useMutation({
    mutationFn: (m: MemberDto) =>
      api.users.update(m.userId, { status: m.status === 'ACTIVE' ? 'REMOVED' : 'ACTIVE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const rows = list.data ?? [];
  const storeName = (id: string) => stores.data?.find((s) => s.id === id)?.name ?? '…';

  return (
    <>
      <PageHeader
        title="User Management"
        description="People who work on this project, their role and their stores."
        actions={<Button onClick={() => setEditing('new')}>New user</Button>}
      />
      {setStatus.error && <Alert>{errorMessage(setStatus.error)}</Alert>}
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={rows.length === 0}
        emptyText="No users."
      />
      {rows.length > 0 && (
        <Table head={['Name', 'Sign-in', 'Role', 'Stores', 'Last sign-in', 'Status', '']}>
          {rows.map((m) => {
            const self = m.userId === me?.user.id;
            return (
              <tr key={m.userId}>
                <Td className="font-medium">
                  {m.name} {self && <Badge>You</Badge>}
                </Td>
                <Td className="text-xs">
                  {m.email && <span className="block">{m.email}</span>}
                  {m.phone && <span className="block">{m.phone}</span>}
                </Td>
                <Td>{m.roleName}</Td>
                <Td className="text-xs">
                  {m.roleCode === 'PROJECT_ADMIN'
                    ? 'All stores'
                    : m.storeIds.map(storeName).join(', ')}
                </Td>
                <Td className="text-xs whitespace-nowrap text-muted-foreground">
                  {m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : 'Never'}
                </Td>
                <Td>
                  {m.status === 'REMOVED' ? (
                    <Badge tone="danger">No access</Badge>
                  ) : m.mustChangePassword ? (
                    <Badge tone="warning">Must change password</Badge>
                  ) : (
                    <Badge tone="success">Active</Badge>
                  )}
                </Td>
                <Td className="text-right whitespace-nowrap">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                    Edit
                  </Button>
                  {!self && (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => setResetting(m)}>
                        Reset password
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => {
                          if (
                            m.status === 'REMOVED' ||
                            window.confirm(`Remove ${m.name}'s access to this project?`)
                          ) {
                            setStatus.mutate(m);
                          }
                        }}
                      >
                        {m.status === 'ACTIVE' ? 'Remove access' : 'Restore access'}
                      </Button>
                    </>
                  )}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      {editing && (
        <UserForm
          member={editing === 'new' ? null : editing}
          stores={stores.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {resetting && <ResetPasswordForm member={resetting} onClose={() => setResetting(null)} />}
    </>
  );
}
