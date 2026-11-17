'use client';

import { ApiError } from '@kavach/api-client';
import type {
  CategoryDto,
  DuplicateCheckResult,
  MaterialDto,
  MaterialInput,
  UnitDto,
} from '@kavach/shared';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { api, errorMessage, useSession } from '@/lib/session';

type Form = Record<
  | 'name'
  | 'categoryId'
  | 'subcategoryId'
  | 'brand'
  | 'grade'
  | 'size'
  | 'specification'
  | 'stockUnitId'
  | 'packSize'
  | 'packUnitId'
  | 'minimumStock'
  | 'description',
  string
> & { isVariableWeight: boolean };

const EMPTY: Form = {
  name: '',
  categoryId: '',
  subcategoryId: '',
  brand: '',
  grade: '',
  size: '',
  specification: '',
  stockUnitId: '',
  packSize: '',
  packUnitId: '',
  minimumStock: '',
  description: '',
  isVariableWeight: false,
};

const fromMaterial = (m: MaterialDto): Form => ({
  name: m.name,
  categoryId: m.categoryId,
  subcategoryId: m.subcategoryId ?? '',
  brand: m.brand ?? '',
  grade: m.grade ?? '',
  size: m.size ?? '',
  specification: m.specification ?? '',
  stockUnitId: m.stockUnitId,
  packSize: m.packSize ?? '',
  packUnitId: m.packUnitId ?? '',
  minimumStock: m.minimumStock ?? '',
  description: m.description ?? '',
  isVariableWeight: m.isVariableWeight,
});

/** '' means "not set": sent as null so an edit can clear a field. */
const toInput = (f: Form): MaterialInput => ({
  name: f.name,
  categoryId: f.categoryId,
  subcategoryId: f.subcategoryId || null,
  brand: f.brand || null,
  grade: f.grade || null,
  size: f.size || null,
  specification: f.specification || null,
  stockUnitId: f.stockUnitId,
  packSize: f.packSize || null,
  packUnitId: f.packUnitId || null,
  minimumStock: f.minimumStock || null,
  description: f.description || null,
  isVariableWeight: f.isVariableWeight,
});

function Duplicates({ result }: { result: DuplicateCheckResult }) {
  if (result.candidates.length === 0) return null;
  return (
    <Alert
      tone={result.exact ? 'danger' : result.needsConfirmation ? 'warning' : 'info'}
      title={
        result.exact
          ? 'This material already exists'
          : result.needsConfirmation
            ? 'A similar material already exists'
            : 'Similar names with a different specification (kept separate)'
      }
    >
      <ul className="mt-2 flex flex-col gap-1.5">
        {result.candidates.map((c) => (
          <li key={c.material.id} className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs">{c.material.code}</span>
            <span className="font-medium">{c.material.name}</span>
            {c.material.status === 'INACTIVE' && <Badge>Inactive</Badge>}
            {c.verdict === 'EXACT' && <Badge tone="danger">Same material</Badge>}
            {c.verdict === 'POSSIBLE_DUPLICATE' && <Badge tone="warning">Possible duplicate</Badge>}
            {c.conflicts.map((x) => (
              <Badge key={x.key} tone="info">
                {x.key.toLowerCase()}: {x.proposed} ≠ {x.existing}
              </Badge>
            ))}
          </li>
        ))}
      </ul>
    </Alert>
  );
}

function MaterialForm({
  material,
  categories,
  units,
  onClose,
}: {
  material: MaterialDto | null;
  categories: CategoryDto[];
  units: UnitDto[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(material ? fromMaterial(material) : EMPTY);
  const [duplicates, setDuplicates] = useState<DuplicateCheckResult | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setDuplicates(null);
    setConfirm(false);
  };

  const save = useMutation({
    mutationFn: async () => {
      const input = toInput(form);
      // Always look before saving, so the user sees what exists (PRD §6.5).
      const found = await api.materials.checkDuplicates({ ...input, excludeId: material?.id });
      setDuplicates(found);
      if (found.exact) throw new Error('This material already exists.');
      if (found.needsConfirmation && !confirm) {
        throw new Error('Check the similar material below, then confirm to continue.');
      }
      return material
        ? api.materials.update(material.id, {
            ...input,
            version: material.version,
            confirmNotDuplicate: confirm,
          })
        : api.materials.create({ ...input, confirmNotDuplicate: confirm });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['materials'] });
      await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onClose();
    },
    onError: (e) => {
      if (
        e instanceof ApiError &&
        e.details &&
        typeof e.details === 'object' &&
        'candidates' in e.details
      ) {
        setDuplicates(e.details as DuplicateCheckResult);
      }
      setError(e instanceof ApiError ? errorMessage(e) : (e as Error).message);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    save.mutate();
  };

  const main = categories.filter((c) => !c.parentId && (c.isActive || c.id === form.categoryId));
  const subs = categories.filter((c) => c.parentId === form.categoryId && c.isActive);
  const activeUnits = units.filter(
    (u) => u.isActive || u.id === form.stockUnitId || u.id === form.packUnitId,
  );
  const stockUnit = units.find((u) => u.id === form.stockUnitId);

  return (
    <Modal title={material ? `Edit ${material.code}` : 'New material'} onClose={onClose} wide>
      <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Material name" className="sm:col-span-2" hint="Example: TMT Steel Bar 12mm">
          {(id) => (
            <Input
              id={id}
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
              autoFocus
            />
          )}
        </Field>
        <Field label="Category">
          {(id) => (
            <Select
              id={id}
              value={form.categoryId}
              onChange={(e) => {
                set('categoryId', e.target.value);
                setForm((f) => ({ ...f, subcategoryId: '' }));
              }}
              required
            >
              <option value="">Choose…</option>
              {main.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subcategory (optional)">
          {(id) => (
            <Select
              id={id}
              value={form.subcategoryId}
              onChange={(e) => set('subcategoryId', e.target.value)}
              disabled={subs.length === 0}
            >
              <option value="">None</option>
              {subs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Brand (optional)">
          {(id) => (
            <Input id={id} value={form.brand} onChange={(e) => set('brand', e.target.value)} />
          )}
        </Field>
        <Field label="Grade (optional)" hint="Example: Fe 550D, 53">
          {(id) => (
            <Input id={id} value={form.grade} onChange={(e) => set('grade', e.target.value)} />
          )}
        </Field>
        <Field label="Size (optional)" hint="Diameter, thickness or dimensions. Example: 12mm">
          {(id) => (
            <Input id={id} value={form.size} onChange={(e) => set('size', e.target.value)} />
          )}
        </Field>
        <Field label="Stock unit" hint="Stock is kept and issued in this unit.">
          {(id) => (
            <Select
              id={id}
              value={form.stockUnitId}
              onChange={(e) => set('stockUnitId', e.target.value)}
              required
            >
              <option value="">Choose…</option>
              {activeUnits.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.code})
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Pack size (optional)" hint="Example: 50 for a 50 kg bag">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={form.packSize}
              onChange={(e) => set('packSize', e.target.value)}
              disabled={form.isVariableWeight}
            />
          )}
        </Field>
        <Field label="Pack unit">
          {(id) => (
            <Select
              id={id}
              value={form.packUnitId}
              onChange={(e) => set('packUnitId', e.target.value)}
              disabled={form.isVariableWeight}
            >
              <option value="">None</option>
              {activeUnits
                .filter((u) => u.id !== form.stockUnitId)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.code})
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field
          label="Minimum stock (optional)"
          hint={
            stockUnit
              ? `Low-stock alert below this many ${stockUnit.name.toLowerCase()}.` +
                (stockUnit.decimalPlaces === 0 ? ' Whole numbers only.' : '')
              : 'Low-stock alert threshold.'
          }
        >
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              value={form.minimumStock}
              onChange={(e) => set('minimumStock', e.target.value)}
            />
          )}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={form.isVariableWeight}
            onChange={(e) => {
              set('isVariableWeight', e.target.checked);
              if (e.target.checked) setForm((f) => ({ ...f, packSize: '', packUnitId: '' }));
            }}
          />
          Weight varies per piece (no fixed conversion)
        </label>
        <Field label="Specification (optional)" className="sm:col-span-2">
          {(id) => (
            <Input
              id={id}
              value={form.specification}
              onChange={(e) => set('specification', e.target.value)}
            />
          )}
        </Field>
        <Field label="Description (optional)" className="sm:col-span-2">
          {(id) => (
            <Textarea
              id={id}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
            />
          )}
        </Field>

        <div className="flex flex-col gap-3 sm:col-span-2">
          {duplicates && <Duplicates result={duplicates} />}
          {duplicates?.needsConfirmation && !duplicates.exact && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              This is a different material. Create it anyway.
            </label>
          )}
          {error && <Alert>{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? 'Saving…' : material ? 'Save changes' : 'Create material'}
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

export default function MaterialsPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'' | 'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<MaterialDto | 'new' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const categories = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const units = useQuery({ queryKey: ['units'], queryFn: api.units.list });
  const list = useQuery({
    queryKey: ['materials', { q, categoryId, status, page }],
    queryFn: () =>
      api.materials.list({
        q: q || undefined,
        categoryId: categoryId || undefined,
        status: status || undefined,
        page,
        pageSize: 25,
      }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (m: MaterialDto) =>
      m.status === 'ACTIVE' ? api.materials.deactivate(m.id) : api.materials.activate(m.id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['materials'] }),
    onError: (e) => setActionError(errorMessage(e)),
  });

  const data = list.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const canEdit = can('material:update');

  return (
    <>
      <PageHeader
        title="Material Master"
        description="Every material used on this project. Similar names with different sizes or grades are separate materials."
        actions={
          can('material:create') && <Button onClick={() => setEditing('new')}>New material</Button>
        }
      />

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_14rem_10rem]">
        <Input
          type="search"
          placeholder="Search by name, brand or Material ID"
          aria-label="Search materials"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
        />
        <Select
          aria-label="Category"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All categories</option>
          {(categories.data ?? [])
            .filter((c) => !c.parentId)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
        <Select
          aria-label="Status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as typeof status);
            setPage(1);
          }}
        >
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="">All</option>
        </Select>
      </div>

      {actionError && <Alert>{actionError}</Alert>}
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={data?.items.length === 0}
        emptyText={q || categoryId ? 'No materials match your search.' : 'No materials yet.'}
      />

      {data && data.items.length > 0 && (
        <>
          <Table
            head={[
              'Material ID',
              'Name',
              'Category',
              'Grade',
              'Size',
              'Unit',
              'Pack',
              'Min stock',
              'Status',
              '',
            ]}
          >
            {data.items.map((m) => (
              <tr key={m.id}>
                <Td className="font-mono text-xs whitespace-nowrap">{m.code}</Td>
                <Td>
                  <span className="font-medium">{m.name}</span>
                  {m.brand && (
                    <span className="block text-xs text-muted-foreground">{m.brand}</span>
                  )}
                </Td>
                <Td>
                  {m.categoryName}
                  {m.subcategoryName && (
                    <span className="block text-xs text-muted-foreground">{m.subcategoryName}</span>
                  )}
                </Td>
                <Td>{m.grade ?? '–'}</Td>
                <Td className="whitespace-nowrap">{m.size ?? '–'}</Td>
                <Td>{m.stockUnitCode}</Td>
                <Td className="whitespace-nowrap">
                  {m.packSize
                    ? `${m.packSize} ${m.packUnitCode}`
                    : m.isVariableWeight
                      ? 'Variable'
                      : '–'}
                </Td>
                <Td className="tabular-nums">{m.minimumStock ?? '–'}</Td>
                <Td>
                  <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>
                    {m.status === 'ACTIVE' ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
                <Td className="text-right whitespace-nowrap">
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => setEditing(m)}>
                      Edit
                    </Button>
                  )}
                  {can('material:deactivate') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={toggle.isPending}
                      onClick={() => {
                        setActionError(null);
                        if (
                          m.status === 'INACTIVE' ||
                          window.confirm(
                            `Deactivate ${m.name}? It can no longer be chosen for new entries.`,
                          )
                        ) {
                          toggle.mutate(m);
                        }
                      }}
                    >
                      {m.status === 'ACTIVE' ? 'Deactivate' : 'Activate'}
                    </Button>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {data.total} material{data.total === 1 ? '' : 's'}
            </span>
            <span className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              Page {page} of {pages}
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </span>
          </div>
        </>
      )}

      {editing && (
        <MaterialForm
          material={editing === 'new' ? null : editing}
          categories={categories.data ?? []}
          units={units.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
