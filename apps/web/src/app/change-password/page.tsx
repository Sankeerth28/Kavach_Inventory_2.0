'use client';

import { PasswordSchema } from '@kavach/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { errorMessage, useSession } from '@/lib/session';

export default function ChangePasswordPage() {
  const session = useSession();
  const router = useRouter();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const forced = session.me?.user.mustChangePassword ?? false;

  useEffect(() => {
    if (session.status === 'anonymous') router.replace('/login');
  }, [session.status, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const check = PasswordSchema.safeParse(next);
    if (!check.success) return setError(check.error.issues[0]?.message ?? 'Password is too weak.');
    if (next !== repeat) return setError('The two new passwords do not match.');
    setBusy(true);
    setError(null);
    try {
      await session.changePassword(current, next);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary via-primary-hover to-sidebar p-4">
      <Card className="w-full max-w-sm p-8 shadow-2xl">
        <h1 className="text-xl font-semibold tracking-tight">Change password</h1>
        <p className="mt-1 mb-5 text-sm text-muted-foreground">
          {forced
            ? 'Your password was set by an administrator. Choose your own to continue.'
            : 'You will be signed out on your other devices.'}
        </p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Current password">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          <Field label="New password" hint="At least 8 characters, with a letter and a number.">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                required
              />
            )}
          </Field>
          <Field label="New password again">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={repeat}
                onChange={(e) => setRepeat(e.target.value)}
                autoComplete="new-password"
                required
              />
            )}
          </Field>
          {error && <Alert>{error}</Alert>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy} className="flex-1">
              {busy ? 'Saving…' : 'Save password'}
            </Button>
            {!forced && (
              <Button variant="secondary" onClick={() => router.back()}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      </Card>
    </main>
  );
}
