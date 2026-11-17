import type { MeResponse, MembershipDto, PermissionCode, StoreDto } from '@kavach/shared';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ApiError, api, onSessionExpired, setProjectId } from './api';

const PROJECT_KEY = 'kavach.projectId';
const storeKey = (projectId: string) => `kavach.storeId.${projectId.replace(/[^A-Za-z0-9]/g, '')}`;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      // Slow networks (PRD §21.5): retry a dropped request a couple of times, nothing else.
      retry: (count, error) => error instanceof ApiError && error.code === 'NETWORK' && count < 2,
    },
  },
});

interface Session {
  status: 'loading' | 'anonymous' | 'signed-in';
  me: MeResponse | null;
  membership: MembershipDto | null;
  can: (permission: PermissionCode) => boolean;
  /** Stores this member may work in. */
  stores: StoreDto[];
  /** The store every screen works in (DECISIONS Q2). null until the stores are loaded. */
  store: StoreDto | null;
  selectStore: (storeId: string) => void;
  selectProject: (projectId: string) => void;
  login: (identifier: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

function Inner({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Session['status']>('loading');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [projectId, setProject] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);

  const adopt = useCallback(async (next: MeResponse | null) => {
    queryClient.clear();
    if (!next) {
      setProjectId(null);
      setMe(null);
      setProject(null);
      setStoreId(null);
      setStatus('anonymous');
      return;
    }
    const wanted = await SecureStore.getItemAsync(PROJECT_KEY).catch(() => null);
    const ids = next.memberships.map((m) => m.projectId);
    const chosen = wanted && ids.includes(wanted) ? wanted : (ids[0] ?? null);
    setProjectId(chosen);
    setStoreId(chosen ? await SecureStore.getItemAsync(storeKey(chosen)).catch(() => null) : null);
    setMe(next);
    setProject(chosen);
    setStatus('signed-in');
  }, []);

  useEffect(() => {
    onSessionExpired(() => void adopt(null));
    api.auth
      .restore()
      .then(adopt)
      // No network at start-up is not a logout: the stored session is tried again on the next call.
      .catch(() => adopt(null));
    return () => onSessionExpired(null);
  }, [adopt]);

  const membership = me?.memberships.find((m) => m.projectId === projectId) ?? null;
  const usable = status === 'signed-in' && !!membership && !me?.user.mustChangePassword;
  const storesQuery = useQuery({
    queryKey: ['stores', projectId],
    queryFn: api.stores.list,
    enabled: usable,
  });

  const session = useMemo<Session>(() => {
    const held = new Set(membership?.permissions ?? []);
    // The API already returns only the stores a Store Manager is assigned to.
    const stores = (storesQuery.data ?? []).filter((s) => s.isActive);
    const store = stores.find((s) => s.id === storeId) ?? stores[0] ?? null;
    return {
      status,
      me,
      membership,
      can: (p) => held.has(p),
      stores,
      store,
      selectStore: (id) => {
        if (!projectId || !stores.some((s) => s.id === id)) return;
        setStoreId(id);
        void SecureStore.setItemAsync(storeKey(projectId), id).catch(() => undefined);
        // Stock is store-level: nothing cached for one store is shown for another.
        for (const key of ['stock', 'transactions', 'invoices', 'home']) {
          void queryClient.invalidateQueries({ queryKey: [key] });
        }
      },
      selectProject: (id) => {
        if (!me?.memberships.some((m) => m.projectId === id)) return;
        void SecureStore.setItemAsync(PROJECT_KEY, id).catch(() => undefined);
        setProjectId(id);
        queryClient.clear();
        setProject(id);
        setStoreId(null);
      },
      login: async (identifier, password) => {
        await adopt(await api.auth.login(identifier, password));
      },
      logout: async () => {
        await api.auth.logout();
        await adopt(null);
      },
      changePassword: async (currentPassword, newPassword) => {
        await adopt(await api.auth.changePassword({ currentPassword, newPassword }));
      },
    };
  }, [status, me, membership, projectId, storeId, storesQuery.data, adopt]);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <Inner>{children}</Inner>
    </QueryClientProvider>
  );
}

export function useSession(): Session {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession must be used inside <SessionProvider>');
  return session;
}

/** After a posting: every view of stock and history is stale. */
export function refreshAfterPosting(): void {
  for (const key of ['stock', 'transactions', 'invoices', 'home']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
