'use client';

import type { CategoryDto } from '@kavach/shared';
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

type Editing =
  { kind: 'new'; parent: CategoryDto | null } | { kind: 'rename'; category: CategoryDto };

function CategoryForm({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(editing.kind === 'rename' ? editing.category.name : '');
  const save = useMutation({
    mutationFn: () =>
      editing.kind === 'rename'
        ? api.categories.update(editing.category.id, { name })
        : api.categories.create({ name, parentId: editing.parent?.id ?? null }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['categories'] });
      onClose();
    },
  });
  const title =
    editing.kind === 'rename'
      ? `Rename ${editing.category.name}`
      : editing.parent
        ? `New subcategory of ${editing.parent.name}`
        : 'New category';
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Name">
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

export default function CategoriesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const list = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const toggle = useMutation({
    mutationFn: (c: CategoryDto) => api.categories.update(c.id, { isActive: !c.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
  });

  const all = list.data ?? [];
  const rows = all
    .filter((c) => !c.parentId)
    .flatMap((c) => [c, ...all.filter((s) => s.parentId === c.id)]);

  return (
    <>
      <PageHeader
        title="Categories"
        description="Material classifications. A category can have subcategories."
        actions={
          <Button onClick={() => setEditing({ kind: 'new', parent: null })}>New category</Button>
        }
      />
      {toggle.error && <Alert>{errorMessage(toggle.error)}</Alert>}
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={rows.length === 0}
        emptyText="No categories yet."
      />
      {rows.length > 0 && (
        <Table head={['Name', 'Status', '']}>
          {rows.map((c) => (
            <tr key={c.id}>
              <Td className={c.parentId ? 'pl-10 text-muted-foreground' : 'font-medium'}>
                {c.parentId && '↳ '}
                {c.name}
              </Td>
              <Td>
                <Badge tone={c.isActive ? 'success' : 'neutral'}>
                  {c.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
              <Td className="text-right whitespace-nowrap">
                {!c.parentId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditing({ kind: 'new', parent: c })}
                  >
                    Add subcategory
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ kind: 'rename', category: c })}
                >
                  Rename
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate(c)}
                >
                  {c.isActive ? 'Deactivate' : 'Activate'}
                </Button>
              </Td>
            </tr>
          ))}
        </Table>
      )}
      {editing && <CategoryForm editing={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
