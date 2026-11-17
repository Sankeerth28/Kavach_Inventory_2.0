'use client';

import type { StoreDto } from '@kavach/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from 'react';
import { api, useSession } from './session';

interface StoreContextValue {
  /** 'ALL' for project-wide aggregated views (Admin only), or a store UUID. */
  selectedStoreId: string | 'ALL';
  /** The selected StoreDto, or null when 'ALL' is selected. */
  selectedStore: StoreDto | null;
  /** Stores the current user is authorized to access and view. */
  authorizedStores: StoreDto[];
  /** All active stores in this project (available to Project Admin). */
  allStores: StoreDto[];
  /** Whether the user is permitted to view project-wide aggregated stock ('ALL'). */
  canSelectAll: boolean;
  /** True when 'ALL' is selected. */
  isAllStores: boolean;
  isLoading: boolean;
  selectStore: (storeId: string | 'ALL') => void;
  isStoreAuthorized: (storeId: string) => boolean;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const { membership } = useSession();
  const queryClient = useQueryClient();
  const projectId = membership?.projectId;

  const storesQuery = useQuery({
    queryKey: ['stores', projectId],
    queryFn: api.stores.list,
    enabled: !!projectId,
  });

  const allStores = useMemo(
    () => (storesQuery.data ?? []).filter((s) => s.isActive),
    [storesQuery.data],
  );

  const canSelectAll = useMemo(() => {
    if (!membership) return false;
    // Project Admin has access to all stores and aggregated views.
    return (
      membership.roleCode === 'PROJECT_ADMIN' ||
      membership.permissions.includes('dashboard:view_full')
    );
  }, [membership]);

  const authorizedStores = useMemo(() => {
    if (!membership) return [];
    if (canSelectAll) return allStores;
    const allowed = new Set(membership.storeIds);
    return allStores.filter((s) => allowed.has(s.id));
  }, [membership, canSelectAll, allStores]);

  const storageKey = projectId ? `kavach.storeId.${projectId}` : null;

  const [explicitStoreId, setExplicitStoreId] = useState<string | 'ALL' | null>(() => {
    if (typeof window === 'undefined' || !storageKey) return null;
    try {
      return window.localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });

  const selectedStoreId = useMemo((): string | 'ALL' => {
    if (!membership) return 'ALL';
    if (explicitStoreId === 'ALL') {
      return canSelectAll ? 'ALL' : (authorizedStores[0]?.id ?? 'ALL');
    }
    if (explicitStoreId && authorizedStores.some((s) => s.id === explicitStoreId)) {
      return explicitStoreId;
    }
    if (canSelectAll) return 'ALL';
    return authorizedStores[0]?.id ?? (membership.storeIds[0] || 'ALL');
  }, [membership, explicitStoreId, canSelectAll, authorizedStores]);

  const selectStore = useCallback(
    (storeId: string | 'ALL') => {
      if (storeId === 'ALL') {
        if (!canSelectAll) return;
        setExplicitStoreId('ALL');
        if (storageKey) {
          try {
            window.localStorage.setItem(storageKey, 'ALL');
          } catch {
            // ignore
          }
        }
        // Invalidate queries so stock, transactions, and dashboards refresh
        void queryClient.invalidateQueries({ queryKey: ['stock'] });
        void queryClient.invalidateQueries({ queryKey: ['transactions'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        void queryClient.invalidateQueries({ queryKey: ['stock-verifications'] });
        return;
      }

      // Check authorization
      const isAllowed = canSelectAll || authorizedStores.some((s) => s.id === storeId);
      if (!isAllowed) return;

      setExplicitStoreId(storeId);
      if (storageKey) {
        try {
          window.localStorage.setItem(storageKey, storeId);
        } catch {
          // ignore
        }
      }

      void queryClient.invalidateQueries({ queryKey: ['stock'] });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['stock-verifications'] });
    },
    [canSelectAll, authorizedStores, storageKey, queryClient],
  );

  const isStoreAuthorized = useCallback(
    (storeId: string): boolean => {
      if (canSelectAll) return allStores.some((s) => s.id === storeId);
      return authorizedStores.some((s) => s.id === storeId);
    },
    [canSelectAll, allStores, authorizedStores],
  );

  const selectedStore = useMemo(() => {
    if (selectedStoreId === 'ALL') return null;
    return allStores.find((s) => s.id === selectedStoreId) ?? null;
  }, [selectedStoreId, allStores]);

  const value = useMemo<StoreContextValue>(
    () => ({
      selectedStoreId,
      selectedStore,
      authorizedStores,
      allStores,
      canSelectAll,
      isAllStores: selectedStoreId === 'ALL',
      isLoading: storesQuery.isLoading,
      selectStore,
      isStoreAuthorized,
    }),
    [
      selectedStoreId,
      selectedStore,
      authorizedStores,
      allStores,
      canSelectAll,
      storesQuery.isLoading,
      selectStore,
      isStoreAuthorized,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreContextValue {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
}
