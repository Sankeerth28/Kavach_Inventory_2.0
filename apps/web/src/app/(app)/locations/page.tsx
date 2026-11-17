'use client';

import { LOCATION_TYPES, type LocationDto, type LocationType } from '@kavach/shared';
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

const TYPE_LABEL: Record<LocationType, string> = {
  TOWER: 'Tower',
  BLOCK: 'Block',
  FLOOR: 'Floor',
  WORK_AREA: 'Work area',
  OTHER: 'Other',
};

/** A sensible default for what goes under each type: Tower → Floor → Work area. */
const CHILD_TYPE: Record<LocationType, LocationType> = {
  TOWER: 'FLOOR',
  BLOCK: 'FLOOR',
  FLOOR: 'WORK_AREA',
  WORK_AREA: 'WORK_AREA',
  OTHER: 'OTHER',
};

type Editing =
  { kind: 'new'; parent: LocationDto | null } | { kind: 'edit'; location: LocationDto };

function LocationForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const queryClient = useQueryClient();
  const existing = editing.kind === 'edit' ? editing.location : null;
  const parent = editing.kind === 'new' ? editing.parent : null;
  const [name, setName] = useState(existing?.name ?? '');
  const [type, setType] = useState<LocationType>(
    existing?.type ?? (parent ? CHILD_TYPE[parent.type] : 'TOWER'),
  );
  const save = useMutation({
    mutationFn: () =>
      existing
        ? api.locations.update(existing.id, { name, type })
        : api.locations.create({ name, type, parentId: parent?.id ?? null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations'] });
      onClose();
    },
  });
  return (
    <Modal
      title={
        existing
          ? `Edit ${existing.name}`
          : parent
            ? `New location in ${parent.path}`
            : 'New location'
      }
      onClose={onClose}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name" hint="Example: Tower A, Floor 3, Flat 302">
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
        <Field label="Type">
          {(id) => (
            <Select id={id} value={type} onChange={(e) => setType(e.target.value as LocationType)}>
              {LOCATION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
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

export default function LocationsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const list = useQuery({ queryKey: ['locations'], queryFn: api.locations.list });
  const toggle = useMutation({
    mutationFn: (l: LocationDto) => api.locations.update(l.id, { isActive: !l.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['locations'] }),
  });
  const rows = list.data ?? [];
  const depth = (l: LocationDto) => l.path.split(' / ').length - 1;

  return (
    <>
      <PageHeader
        title="Locations"
        description="Where materials are issued to and returned from: towers, floors and work areas."
        actions={
          <Button onClick={() => setEditing({ kind: 'new', parent: null })}>New location</Button>
        }
      />
      {toggle.error && <Alert>{errorMessage(toggle.error)}</Alert>}
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={rows.length === 0}
        emptyText="No locations yet. Start with a tower or block."
      />
      {rows.length > 0 && (
        <Table head={['Location', 'Type', 'Status', '']}>
          {rows.map((l) => (
            <tr key={l.id}>
              <Td>
                <span
                  style={{ paddingLeft: `${depth(l) * 1.25}rem` }}
                  className={depth(l) === 0 ? 'font-medium' : ''}
                >
                  {depth(l) > 0 && '↳ '}
                  {l.name}
                </span>
              </Td>
              <Td>{TYPE_LABEL[l.type]}</Td>
              <Td>
                <Badge tone={l.isActive ? 'success' : 'neutral'}>
                  {l.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
              <Td className="text-right whitespace-nowrap">
                {l.isActive && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ kind: 'new', parent: l })}
                  >
                    Add inside
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ kind: 'edit', location: l })}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() => {
                    if (
                      !l.isActive ||
                      window.confirm(`Deactivate ${l.path} and everything inside it?`)
                    ) {
                      toggle.mutate(l);
                    }
                  }}
                >
                  {l.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <LocationForm editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
