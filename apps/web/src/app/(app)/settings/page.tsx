'use client';

import type { ConfidenceThresholds, ProjectDto } from '@kavach/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { Alert, Button, Card, Field, Input, PageHeader, Textarea } from '@/components/ui';
import { api, errorMessage } from '@/lib/session';

function ProjectForm({ project }: { project: ProjectDto }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(project.name);
  const [address, setAddress] = useState(project.address ?? '');
  const [timezone, setTimezone] = useState(project.timezone);
  const save = useMutation({
    mutationFn: () => api.project.update({ name, address: address || null, timezone }),
    onSuccess: (updated) => queryClient.setQueryData(['project'], updated),
  });
  return (
    <Card className="max-w-xl p-5">
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Project code" hint="Set when the project was created. Cannot be changed.">
          {(id) => <Input id={id} value={project.code} disabled />}
        </Field>
        <Field label="Project name">
          {(id) => (
            <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />
          )}
        </Field>
        <Field label="Site address">
          {(id) => (
            <Textarea id={id} value={address} onChange={(e) => setAddress(e.target.value)} />
          )}
        </Field>
        <Field label="Time zone" hint='Decides what counts as "today" in dashboards and reports.'>
          {(id) => (
            <Input
              id={id}
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              required
            />
          )}
        </Field>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="success">Saved.</Alert>}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

/** PRD §8.2: the confidence thresholds are configurable operating values. */
function ConfidenceForm({ value }: { value: ConfidenceThresholds }) {
  const queryClient = useQueryClient();
  const [auto, setAuto] = useState(String(Math.round(value.auto * 100)));
  const [confirm, setConfirm] = useState(String(Math.round(value.confirm * 100)));
  const save = useMutation({
    mutationFn: () =>
      api.settings.setConfidence({ auto: Number(auto) / 100, confirm: Number(confirm) / 100 }),
    onSuccess: (updated) => queryClient.setQueryData(['confidence'], updated),
  });
  return (
    <Card className="mt-6 max-w-xl p-5">
      <h2 className="text-base font-semibold">AI confidence</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        How sure the system must be before it suggests a material match. A specification or unit
        conflict always goes to review, whatever the confidence.
      </p>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field
          label="High confidence from (%)"
          hint="At or above: the match is pre-selected and needs no tick."
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={50}
              max={100}
              value={auto}
              onChange={(e) => setAuto(e.target.value)}
              required
            />
          )}
        </Field>
        <Field
          label="Needs confirmation from (%)"
          hint="Between the two: suggested, and the user must tick the line. Below: the user chooses."
        >
          {(id) => (
            <Input
              id={id}
              type="number"
              min={10}
              max={100}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
            />
          )}
        </Field>
        {save.error && <Alert>{errorMessage(save.error)}</Alert>}
        {save.isSuccess && (
          <Alert tone="success">Saved. Applies to documents read from now on.</Alert>
        )}
        <div>
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export default function SettingsPage() {
  const project = useQuery({ queryKey: ['project'], queryFn: api.project.get });
  const confidence = useQuery({ queryKey: ['confidence'], queryFn: api.settings.getConfidence });
  return (
    <>
      <PageHeader title="Settings" description="Details of this project." />
      {project.error && <Alert>{errorMessage(project.error)}</Alert>}
      {project.isPending && <p className="text-sm text-muted-foreground">Loading…</p>}
      {project.data && <ProjectForm key={project.data.id} project={project.data} />}
      {confidence.data && (
        <ConfidenceForm
          key={`${confidence.data.auto}-${confidence.data.confirm}`}
          value={confidence.data}
        />
      )}
    </>
  );
}
