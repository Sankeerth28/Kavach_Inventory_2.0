'use client';

import { APP_NAME } from '@kavach/shared';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { Alert, Button, Card, Field, Input } from '@/components/ui';
import { errorMessage, useSession } from '@/lib/session';

export default function LoginPage() {
  const session = useSession();
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (session.status === 'signed-in') {
      router.replace(session.me?.user.mustChangePassword ? '/change-password' : '/dashboard');
    }
  }, [session.status, session.me, router]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.login(identifier, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-primary via-primary-hover to-sidebar p-4">
      <Card className="w-full max-w-sm p-8 shadow-2xl">
        <span className="mb-4 flex size-12 items-center justify-center rounded-xl bg-primary text-2xl font-bold text-primary-foreground shadow-sm">
          K
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">Construction material inventory</p>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="E-mail or mobile number">
            {(id) => (
              <Input
                id={id}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                autoFocus
                required
              />
            )}
          </Field>
          <Field label="Password">
            {(id) => (
              <Input
                id={id}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            )}
          </Field>
          {error && <Alert>{error}</Alert>}
          <Button type="submit" disabled={busy || session.status === 'loading'}>
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
        <p className="mt-4 text-xs text-muted-foreground">
          Forgot your password? Ask your Project Admin to reset it.
        </p>
      </Card>
    </main>
  );
}
