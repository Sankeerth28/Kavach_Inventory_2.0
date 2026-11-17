'use client';

import type { SupplierDto, SupplierMappingDto } from '@kavach/shared';
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
  Textarea,
} from '@/components/ui';
import { api, errorMessage } from '@/lib/session';
import { cn } from '@/lib/utils';

/** Supplier master and learned supplier mappings (PRD §4 module 9, §9). Project Admin. */
function SupplierForm({
  supplier,
  onClose,
}: {
  supplier: SupplierDto | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(supplier?.name ?? '');
  const [gstin, setGstin] = useState(supplier?.gstin ?? '');
  const [phone, setPhone] = useState(supplier?.phone ?? '');
  const [address, setAddress] = useState(supplier?.address ?? '');
  const save = useMutation({
    mutationFn: () => {
      const input = {
        name: name.trim(),
        gstin: gstin.trim() || null,
        address: address.trim() || null,
      };
      return supplier
        ? api.suppliers.update(supplier.id, { ...input, phone: phone.trim() || null })
        : api.suppliers.create({ ...input, phone: phone.trim() || undefined });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      onClose();
    },
  });
  return (
    <Modal title={supplier ? 'Edit supplier' : 'Add supplier'} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Supplier name">
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          )}
        </Field>
        <Field label="GSTIN" hint="15 characters. Optional.">
          {(id) => (
            <Input
              id={id}
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              maxLength={15}
            />
          )}
        </Field>
        <Field label="Phone">
          {(id) => (
            <Input
              id={id}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
            />
          )}
        </Field>
        <Field label="Address">
          {(id) => (
            <Textarea id={id} value={address} onChange={(e) => setAddress(e.target.value)} />
          )}
        </Field>
        {supplier && supplier.aliases.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Also written as: {supplier.aliases.join('; ')}
          </p>
        )}
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function Mappings({ suppliers }: { suppliers: SupplierDto[] }) {
  const queryClient = useQueryClient();
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState<'CONFIRMED' | 'DISABLED' | ''>('CONFIRMED');
  const [target, setTarget] = useState<SupplierMappingDto | null>(null);
  const [reason, setReason] = useState('');
  const list = useQuery({
    queryKey: ['supplier-mappings', supplierId, status],
    queryFn: () =>
      api.supplierMappings.list({
        supplierId: supplierId || undefined,
        status: status || undefined,
        pageSize: 200,
      }),
  });
  const disable = useMutation({
    mutationFn: () => api.supplierMappings.disable(target!.id, reason.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['supplier-mappings'] });
      void queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setTarget(null);
      setReason('');
    },
  });
  return (
    <>
      <p className="mb-3 text-sm text-muted-foreground">
        A mapping is saved when a Store Manager confirms a receipt. The next document from the same
        supplier with the same description is matched to the same material. Disable a mapping that
        is wrong.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <Select
          aria-label="Supplier"
          className="w-64"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">All suppliers</option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Status"
          className="w-44"
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
        >
          <option value="CONFIRMED">In use</option>
          <option value="DISABLED">Disabled</option>
          <option value="">All</option>
        </Select>
      </div>
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={list.data?.items.length === 0}
        emptyText="No mappings yet. They appear after documents are received."
      />
      {list.data && list.data.items.length > 0 && (
        <Table
          head={[
            'Supplier',
            'Written on the document as',
            'KAVACH material',
            'Used',
            'Confirmed by',
            'Status',
            '',
          ]}
        >
          {list.data.items.map((mp) => (
            <tr key={mp.id}>
              <Td>{mp.supplierName}</Td>
              <Td className="font-mono text-xs">{mp.description}</Td>
              <Td>
                {mp.materialName}
                <div className="text-xs text-muted-foreground">{mp.materialCode}</div>
              </Td>
              <Td>{mp.timesUsed}×</Td>
              <Td className="text-xs text-muted-foreground">
                {mp.confirmedByName}
                <br />
                {new Date(mp.confirmedAt).toLocaleDateString()}
              </Td>
              <Td>
                <Badge tone={mp.status === 'CONFIRMED' ? 'success' : 'neutral'}>
                  {mp.status === 'CONFIRMED' ? 'In use' : 'Disabled'}
                </Badge>
                {mp.disabledReason && (
                  <div className="mt-1 max-w-xs text-xs text-muted-foreground">
                    {mp.disabledReason}
                  </div>
                )}
              </Td>
              <Td>
                {mp.status === 'CONFIRMED' && (
                  <Button size="sm" variant="secondary" onClick={() => setTarget(mp)}>
                    Disable
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {target && (
        <Modal title="Disable mapping" onClose={() => setTarget(null)}>
          <p className="mb-3 text-sm">
            “{target.description}” from {target.supplierName} will no longer be matched to{' '}
            {target.materialName} automatically. Past receipts are not changed.
          </p>
          <Field label="Reason">
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
          {disable.error && (
            <div className="mt-3">
              <Alert>{errorMessage(disable.error)}</Alert>
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={reason.trim().length < 3 || disable.isPending}
              onClick={() => disable.mutate()}
            >
              Disable
            </Button>
          </div>
        </Modal>
      )}
    </>
  );
}

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'suppliers' | 'mappings'>('suppliers');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<SupplierDto | 'new' | null>(null);
  const suppliers = useQuery({
    queryKey: ['suppliers', 'all'],
    queryFn: () => api.suppliers.list({ includeInactive: true }),
  });
  const setActive = useMutation({
    mutationFn: (s: SupplierDto) => api.suppliers.update(s.id, { isActive: !s.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['suppliers'] }),
  });
  const shown = (suppliers.data ?? []).filter(
    (s) =>
      !q ||
      `${s.name} ${s.gstin ?? ''} ${s.aliases.join(' ')}`.toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <>
      <PageHeader
        title="Suppliers"
        description="Suppliers of this project and what the system has learned about their invoice descriptions."
        actions={
          tab === 'suppliers' ? (
            <Button onClick={() => setEditing('new')}>+ Add Supplier</Button>
          ) : undefined
        }
      />
      <div className="mb-4 flex border-b border-border">
        {(['suppliers', 'mappings'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-4 py-2 text-sm font-medium',
              tab === t
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t === 'suppliers' ? 'Suppliers' : 'Supplier mappings'}
          </button>
        ))}
      </div>

      {tab === 'suppliers' ? (
        <>
          <Input
            aria-label="Search suppliers"
            className="mb-3 max-w-sm"
            placeholder="Search by name or GSTIN"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {setActive.error && (
            <div className="mb-3">
              <Alert>{errorMessage(setActive.error)}</Alert>
            </div>
          )}
          <ListState
            loading={suppliers.isPending}
            error={suppliers.error ? errorMessage(suppliers.error) : null}
            empty={shown.length === 0}
            emptyText="No suppliers yet. A supplier is also added when a Store Manager receives its first document."
          />
          {shown.length > 0 && (
            <Table head={['Supplier', 'GSTIN', 'Phone', 'Mappings', 'Status', '']}>
              {shown.map((s) => (
                <tr key={s.id}>
                  <Td>
                    <span className="font-medium">{s.name}</span>
                    {s.aliases.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Also: {s.aliases.join('; ')}
                      </div>
                    )}
                    {s.address && <div className="text-xs text-muted-foreground">{s.address}</div>}
                  </Td>
                  <Td className="font-mono text-xs">{s.gstin ?? '—'}</Td>
                  <Td>{s.phone ?? '—'}</Td>
                  <Td>{s.mappingCount}</Td>
                  <Td>
                    <Badge tone={s.isActive ? 'success' : 'neutral'}>
                      {s.isActive ? 'Active' : 'Inactive'}
                    </Badge>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={setActive.isPending}
                        onClick={() => setActive.mutate(s)}
                      >
                        {s.isActive ? 'Deactivate' : 'Activate'}
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </>
      ) : (
        <Mappings suppliers={suppliers.data ?? []} />
      )}
      {editing && (
        <SupplierForm
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
