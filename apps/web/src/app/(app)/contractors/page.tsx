'use client';

import type { ContractorDto } from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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

export default function ContractorsPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();

  const contractorsQuery = useQuery({
    queryKey: ['contractors'],
    queryFn: api.contractors.list,
  });

  const contractors = contractorsQuery.data ?? [];

  // Create modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmNotDuplicate, setConfirmNotDuplicate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Edit modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingContractor, setEditingContractor] = useState<ContractorDto | null>(null);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editActive, setEditActive] = useState(true);

  // Merge modal (Admin only, Q31)
  const [mergeModalOpen, setMergeModalOpen] = useState(false);
  const [sourceContractor, setSourceContractor] = useState<ContractorDto | null>(null);
  const [targetContractorId, setTargetContractorId] = useState('');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const canManage = can('contractor:manage');

  const handleCreate = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setCreateError(null);
    try {
      await api.contractors.create({
        name: name.trim(),
        phone: phone.trim() || undefined,
        confirmNotDuplicate,
      });
      setCreateModalOpen(false);
      setName('');
      setPhone('');
      setConfirmNotDuplicate(false);
      void queryClient.invalidateQueries({ queryKey: ['contractors'] });
    } catch (err) {
      setCreateError(errorMessage(err));
      // If duplicate conflict, prompt confirmation
      if (
        errorMessage(err).toLowerCase().includes('duplicate') ||
        errorMessage(err).toLowerCase().includes('similar')
      ) {
        setConfirmNotDuplicate(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingContractor || !editName.trim()) return;
    setSaving(true);
    try {
      await api.contractors.update(editingContractor.id, {
        name: editName.trim(),
        phone: editPhone.trim() || undefined,
        isActive: editActive,
      });
      setEditModalOpen(false);
      setEditingContractor(null);
      void queryClient.invalidateQueries({ queryKey: ['contractors'] });
    } catch (err) {
      setCreateError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleMerge = async () => {
    if (!sourceContractor || !targetContractorId) return;
    setMerging(true);
    setMergeError(null);
    try {
      await api.contractors.merge(sourceContractor.id, {
        intoId: targetContractorId,
      });
      setMergeModalOpen(false);
      setSourceContractor(null);
      setTargetContractorId('');
      void queryClient.invalidateQueries({ queryKey: ['contractors'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    } catch (err) {
      setMergeError(errorMessage(err));
    } finally {
      setMerging(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contractors Master"
        description="Approved project contractors for material issues and return tracking (PRD §14, Q31)."
        actions={
          canManage ? (
            <Button size="sm" onClick={() => setCreateModalOpen(true)}>
              + Add Contractor
            </Button>
          ) : undefined
        }
      />

      <ListState
        loading={contractorsQuery.isLoading}
        error={contractorsQuery.error ? errorMessage(contractorsQuery.error) : null}
        empty={contractors.length === 0}
        emptyText="No contractors registered for this project."
      />

      {contractors.length > 0 && (
        <Table
          head={['Contractor Name', 'Phone', 'Status', canManage ? 'Actions' : ''].filter(Boolean)}
        >
          {contractors.map((c) => (
            <tr key={c.id} className="hover:bg-muted/40">
              <Td className="font-medium text-foreground">
                {c.name}
                {c.mergedIntoId && (
                  <span className="ml-2 text-xs text-muted-foreground font-normal">
                    (Merged into{' '}
                    {contractors.find((tc) => tc.id === c.mergedIntoId)?.name ??
                      'another contractor'}
                    )
                  </span>
                )}
              </Td>
              <Td className="text-muted-foreground font-mono text-xs">{c.phone ?? '—'}</Td>
              <Td>
                <Badge tone={c.mergedIntoId ? 'neutral' : c.isActive ? 'success' : 'neutral'}>
                  {c.mergedIntoId ? 'Merged' : c.isActive ? 'Active' : 'Inactive'}
                </Badge>
              </Td>
              {canManage && (
                <Td>
                  {!c.mergedIntoId && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="h-7 text-xs"
                        onClick={() => {
                          setEditingContractor(c);
                          setEditName(c.name);
                          setEditPhone(c.phone ?? '');
                          setEditActive(c.isActive);
                          setEditModalOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-primary"
                        onClick={() => {
                          setSourceContractor(c);
                          setTargetContractorId('');
                          setMergeModalOpen(true);
                        }}
                      >
                        Merge into…
                      </Button>
                    </div>
                  )}
                </Td>
              )}
            </tr>
          ))}
        </Table>
      )}

      {/* ── Create Modal ──────────────────────────────────────────────────── */}
      {createModalOpen && (
        <Modal title="Add New Contractor" onClose={() => setCreateModalOpen(false)}>
          <div className="space-y-4">
            {createError && <Alert>{createError}</Alert>}

            <Field label="Contractor Name">
              {(id) => (
                <Input
                  id={id}
                  placeholder="e.g. Ramesh Earthmovers Pvt Ltd"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
              )}
            </Field>

            <Field label="Phone Number (optional)">
              {(id) => (
                <Input
                  id={id}
                  placeholder="e.g. +91 98765 43210"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              )}
            </Field>

            {confirmNotDuplicate && (
              <label className="flex items-center gap-2 text-xs font-medium cursor-pointer text-warning">
                <input
                  type="checkbox"
                  checked={confirmNotDuplicate}
                  onChange={(e) => setConfirmNotDuplicate(e.target.checked)}
                />
                Confirm this is NOT an accidental duplicate of an existing contractor.
              </label>
            )}

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setCreateModalOpen(false)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button onClick={handleCreate} disabled={saving || !name.trim()}>
                {saving ? 'Saving…' : 'Add Contractor'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit Modal ────────────────────────────────────────────────────── */}
      {editModalOpen && editingContractor && (
        <Modal
          title={`Edit Contractor — ${editingContractor.name}`}
          onClose={() => setEditModalOpen(false)}
        >
          <div className="space-y-4">
            <Field label="Contractor Name">
              {(id) => (
                <Input
                  id={id}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  required
                />
              )}
            </Field>

            <Field label="Phone">
              {(id) => (
                <Input id={id} value={editPhone} onChange={(e) => setEditPhone(e.target.value)} />
              )}
            </Field>

            <div className="flex items-center gap-2 pt-2">
              <input
                type="checkbox"
                id="edit-active"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
                className="h-4 w-4"
              />
              <label htmlFor="edit-active" className="text-sm font-medium">
                Active contractor (can be selected for issues)
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button variant="secondary" onClick={() => setEditModalOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button onClick={handleUpdate} disabled={saving || !editName.trim()}>
                {saving ? 'Updating…' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Merge Modal (Admin only, Q31) ─────────────────────────────────── */}
      {mergeModalOpen && sourceContractor && (
        <Modal
          title={`Merge Contractor — ${sourceContractor.name}`}
          onClose={() => setMergeModalOpen(false)}
        >
          <div className="space-y-4">
            <Alert tone="warning" title="Contractor Merge (PRD Q31)">
              Merging will deactivate <strong>{sourceContractor.name}</strong> and redirect future
              references to the target contractor. Past transaction history remains intact. This
              action cannot be undone.
            </Alert>

            {mergeError && <Alert>{mergeError}</Alert>}

            <Field label="Merge into Target Contractor">
              {(id) => (
                <Select
                  id={id}
                  value={targetContractorId}
                  onChange={(e) => setTargetContractorId(e.target.value)}
                  required
                >
                  <option value="">Select target contractor…</option>
                  {contractors
                    .filter((c) => c.id !== sourceContractor.id && !c.mergedIntoId && c.isActive)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.phone ? `(${c.phone})` : ''}
                      </option>
                    ))}
                </Select>
              )}
            </Field>

            <div className="flex justify-end gap-3 pt-3 border-t">
              <Button
                variant="secondary"
                onClick={() => setMergeModalOpen(false)}
                disabled={merging}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleMerge}
                disabled={merging || !targetContractorId}
              >
                {merging ? 'Merging…' : 'Confirm & Merge Contractor'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
