'use client';

import type { StoreDto } from '@kavach/shared';
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
  Table,
  Td,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/session';

function StoreForm({ store, onClose }: { store: StoreDto | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState(store?.code ?? '');
  const [name, setName] = useState(store?.name ?? '');
  const [address, setAddress] = useState(store?.address ?? '');
  const save = useMutation({
    mutationFn: () =>
      store
        ? api.stores.update(store.id, { name, address: address || null })
        : api.stores.create({ code, name, address: address || null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['stores'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
  });
  return (
    <Modal title={store ? `Edit ${store.name}` : 'New store'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Code" hint="Short and unique, e.g. TWR-B. Cannot be changed later.">
          {(id) => (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              disabled={store !== null}
              required
              autoFocus={!store}
            />
          )}
        </Field>
        <Field label="Name">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />
          )}
        </Field>
        <Field label="Address (optional)">
          {(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} />}
        </Field>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function StoresPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StoreDto | 'new' | null>(null);
  const list = useQuery({ queryKey: ['stores'], queryFn: api.stores.list });
  const toggle = useMutation({
    mutationFn: (s: StoreDto) => api.stores.update(s.id, { isActive: !s.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['stores'] }),
  });
  const rows = list.data ?? [];

  return (
    <>
      <PageHeader
        title="Stores"
        description="Physical stores on this project. Stock is tracked per store."
        actions={<Button onClick={() => setEditing('new')}>New store</Button>}
      />
      {toggle.error && <Alert>{errorMessage(toggle.error)}</Alert>}
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={rows.length === 0}
        emptyText="No stores."
      />
      {rows.length > 0 && (
        <Table head={['Code', 'Name', 'Address', 'Status', '']}>
          {rows.map((s) => (
            <tr key={s.id}>
              <Td className="font-mono text-xs">{s.code}</Td>
              <Td className="font-medium">{s.name}</Td>
              <Td className="text-muted-foreground">{s.address ?? '–'}</Td>
              <Td>
                <Badge tone={s.isActive ? 'success' : 'neutral'}>
                  {s.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
              <Td className="text-right whitespace-nowrap">
                <Button variant="ghost" size="sm" onClick={() => setEditing(s)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(s)}
                >
                  {s.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <StoreForm store={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
    </>
  );
}
