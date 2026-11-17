'use client';

import { UNIT_DIMENSIONS, type UnitDimension, type UnitDto } from '@kavach/shared';
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
import { api, errorMessage } from '@/lib/session';

const DIMENSION_LABEL: Record<UnitDimension, string> = {
  COUNT: 'Count',
  MASS: 'Weight',
  LENGTH: 'Length',
  VOLUME: 'Volume',
  AREA: 'Area',
};

function UnitForm({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [dimension, setDimension] = useState<UnitDimension>('COUNT');
  const [whole, setWhole] = useState(true);
  const save = useMutation({
    mutationFn: () =>
      api.units.create({
        code,
        name,
        symbol: symbol || code.toLowerCase(),
        dimension,
        decimalPlaces: whole ? 0 : 3,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['units'] });
      onClose();
    },
  });
  return (
    <Modal title="New unit" onClose={onClose}>
      <form
        className="grid grid-cols-2 gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Code" hint="Short, e.g. SQFT">
          {(id) => (
            <Input
              id={id}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              required
              autoFocus
            />
          )}
        </Field>
        <Field label="Symbol" hint="As printed, e.g. sq ft">
          {(id) => <Input id={id} value={symbol} onChange={(e) => setSymbol(e.target.value)} />}
        </Field>
        <Field label="Name" className="col-span-2">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />
          )}
        </Field>
        <Field label="Measures">
          {(id) => (
            <Select
              id={id}
              value={dimension}
              onChange={(e) => {
                const d = e.target.value as UnitDimension;
                setDimension(d);
                setWhole(d === 'COUNT');
              }}
            >
              {UNIT_DIMENSIONS.map((d) => (
                <option key={d} value={d}>
                  {DIMENSION_LABEL[d]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={whole}
            onChange={(e) => setWhole(e.target.checked)}
          />
          Whole numbers only
        </label>
        <div className="col-span-2 flex flex-col gap-3">
          {save.error && <Alert>{errorMessage(save.error)}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              Create unit
            </Button>
          </div>
        </div>
      </form>
    </Modal>
  );
}

function ConversionForm({ units, onClose }: { units: UnitDto[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fromUnitId, setFrom] = useState('');
  const [toUnitId, setTo] = useState('');
  const [factor, setFactor] = useState('');
  const save = useMutation({
    mutationFn: () => api.conversions.create({ fromUnitId, toUnitId, factor }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conversions'] });
      onClose();
    },
  });
  const code = (id: string) => units.find((u) => u.id === id)?.code ?? '…';
  const options = units
    .filter((u) => u.isActive)
    .map((u) => (
      <option key={u.id} value={u.id}>
        {u.name} ({u.code})
      </option>
    ));
  return (
    <Modal title="Approve a conversion" onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Alert tone="info">
          Only approved conversions are ever applied. A pack size (for example 50 kg per bag)
          belongs on the material, not here.
        </Alert>
        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-3">
          <Field label="1 of">
            {(id) => (
              <Select id={id} value={fromUnitId} onChange={(e) => setFrom(e.target.value)} required>
                <option value="">Choose…</option>
                {options}
              </Select>
            )}
          </Field>
          <span className="pb-2.5">=</span>
          <Field label="How many">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
                required
              />
            )}
          </Field>
        </div>
        <Field label="of">
          {(id) => (
            <Select id={id} value={toUnitId} onChange={(e) => setTo(e.target.value)} required>
              <option value="">Choose…</option>
              {options}
            </Select>
          )}
        </Field>
        {fromUnitId && toUnitId && factor && (
          <p className="text-sm text-muted-foreground">
            1 {code(fromUnitId)} = {factor} {code(toUnitId)}
          </p>
        )}
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.isPending}>
            Approve
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export default function UnitsPage() {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'unit' | 'conversion' | null>(null);
  const units = useQuery({ queryKey: ['units'], queryFn: api.units.list });
  const conversions = useQuery({ queryKey: ['conversions'], queryFn: api.conversions.list });

  const toggleUnit = useMutation({
    mutationFn: (u: UnitDto) => api.units.update(u.id, { isActive: !u.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['units'] }),
  });
  const toggleConversion = useMutation({
    mutationFn: (c: { id: string; isActive: boolean }) =>
      api.conversions.setActive(c.id, !c.isActive),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['conversions'] }),
  });

  const unitList = units.data ?? [];
  const code = (id: string) => unitList.find((u) => u.id === id)?.code ?? '?';
  const actionError = toggleUnit.error ?? toggleConversion.error;

  return (
    <>
      <PageHeader
        title="Units"
        description="The unit master and the conversions approved for this project."
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog('conversion')}>
              Approve conversion
            </Button>
            <Button onClick={() => setDialog('unit')}>New unit</Button>
          </>
        }
      />
      {actionError && <Alert>{errorMessage(actionError)}</Alert>}
      <ListState
        loading={units.isPending}
        error={units.error ? errorMessage(units.error) : null}
        empty={false}
        emptyText=""
      />
      {unitList.length > 0 && (
        <Table head={['Code', 'Name', 'Measures', 'Quantities', 'Type', 'Status', '']}>
          {unitList.map((u) => (
            <tr key={u.id}>
              <Td className="font-mono text-xs">{u.code}</Td>
              <Td className="font-medium">{u.name}</Td>
              <Td>{DIMENSION_LABEL[u.dimension]}</Td>
              <Td>
                {u.decimalPlaces === 0 ? 'Whole numbers' : `Up to ${u.decimalPlaces} decimals`}
              </Td>
              <Td>{u.isSystem ? <Badge>Standard</Badge> : <Badge tone="info">Project</Badge>}</Td>
              <Td>
                <Badge tone={u.isActive ? 'success' : 'neutral'}>
                  {u.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
              <Td className="text-right">
                {!u.isSystem && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggleUnit.isPending}
                    onClick={() => toggleUnit.mutate(u)}
                  >
                    {u.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      <h2 className="mt-8 mb-3 text-base font-semibold">Approved conversions</h2>
      <ListState
        loading={conversions.isPending}
        error={conversions.error ? errorMessage(conversions.error) : null}
        empty={conversions.data?.length === 0}
        emptyText="No conversions."
      />
      {(conversions.data?.length ?? 0) > 0 && (
        <Table head={['Conversion', 'Applies to', 'Type', 'Status', '']}>
          {conversions.data!.map((c) => (
            <tr key={c.id}>
              <Td className="font-medium tabular-nums whitespace-nowrap">
                1 {code(c.fromUnitId)} = {c.factor} {code(c.toUnitId)}
              </Td>
              <Td>{c.materialId ? 'One material' : 'All materials'}</Td>
              <Td>{c.isSystem ? <Badge>Standard</Badge> : <Badge tone="info">Project</Badge>}</Td>
              <Td>
                <Badge tone={c.isActive ? 'success' : 'neutral'}>
                  {c.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
              <Td className="text-right">
                {!c.isSystem && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggleConversion.isPending}
                    onClick={() => toggleConversion.mutate(c)}
                  >
                    {c.isActive ? 'Deactivate' : 'Activate'}
                  </Button>
                )}
              </Td>
            </tr>
          ))}
        </Table>
      )}

      {dialog === 'unit' && <UnitForm onClose={() => setDialog(null)} />}
      {dialog === 'conversion' && (
        <ConversionForm units={unitList} onClose={() => setDialog(null)} />
      )}
    </>
  );
}
