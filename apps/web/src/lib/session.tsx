'use client';

import { ApiError, createApiClient } from '@kavach/api-client';
import type { MeResponse, MembershipDto, PermissionCode } from '@kavach/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const PROJECT_KEY = 'kavach.projectId';

let currentProjectId: string | null = null;
let onExpired: (() => void) | null = null;

/** One client for the browser tab. The access token stays in memory; the refresh token is an httpOnly cookie. */
export const api = createApiClient({
  baseUrl: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001',
  mode: 'web',
  getProjectId: () => currentProjectId,
  onSessionExpired: () => onExpired?.(),
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: false,
      retry: (count, error) =>
        error instanceof ApiError && error.code === 'NETWORK' ? count < 2 : false,
    },
  },
});

interface Session {
  status: 'loading' | 'anonymous' | 'signed-in';
  me: MeResponse | null;
  membership: MembershipDto | null;
  can: (permission: PermissionCode) => boolean;
  login: (identifier: string, password: string) => Promise<MeResponse>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
  selectProject: (projectId: string) => void;
}

const SessionContext = createContext<Session | null>(null);

function pickProject(me: MeResponse, wanted: string | null): string | null {
  const ids = me.memberships.map((m) => m.projectId);
  return wanted && ids.includes(wanted) ? wanted : (ids[0] ?? null);
}

export function Providers({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Session['status']>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [projectId, setProjectId] = useState<string | null>(null);

  const adopt = useCallback((next: MeResponse | null) => {
    queryClient.clear();
    if (!next) {
      currentProjectId = null;
      setMe(null);
      setProjectId(null);
      setStatus('anonymous');
      return;
    }
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(PROJECT_KEY);
    } catch {
      // Storage can be unavailable (private mode): fall back to the first project.
    }
    currentProjectId = pickProject(next, stored);
    setMe(next);
    setProjectId(currentProjectId);
    setStatus('signed-in');
  }, []);

  useEffect(() => {
    onExpired = () => adopt(null);
    api.auth
      .restore()
      .then(adopt)
      .catch(() => adopt(null));
    return () => {
      onExpired = null;
    };
  }, [adopt]);

  const session = useMemo<Session>(() => {
    const membership = me?.memberships.find((m) => m.projectId === projectId) ?? null;
    const held = new Set(membership?.permissions ?? []);
    return {
      status,
      me,
      membership,
      can: (permission) => held.has(permission),
      login: async (identifier, password) => {
        const auth = await api.auth.login(identifier, password);
        adopt(auth);
        return auth;
      },
      logout: async () => {
        await api.auth.logout();
        adopt(null);
      },
      changePassword: async (currentPassword, newPassword) => {
        adopt(await api.auth.changePassword({ currentPassword, newPassword }));
      },
      selectProject: (id) => {
        if (!me?.memberships.some((m) => m.projectId === id)) return;
        try {
          window.localStorage.setItem(PROJECT_KEY, id);
        } catch {
          // Not persisted; the choice still holds for this tab.
        }
        currentProjectId = id;
        // Nothing cached for one project may be shown in another.
        queryClient.clear();
        setProjectId(id);
      },
    };
  }, [status, me, projectId, adopt]);

  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider value={session}>{children}</SessionContext.Provider>
    </QueryClientProvider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <Providers>');
  return session;
}

/** A plain-language message for any failure (PRD §25.4). */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'VALIDATION_FAILED' && Array.isArray(error.details)) {
      const first = error.details[0] as { path?: string; message?: string } | undefined;
      if (first?.message) return first.path ? `${first.path}: ${first.message}` : first.message;
    }
    return error.message;
  }
  return 'Something went wrong. Please try again.';
}
