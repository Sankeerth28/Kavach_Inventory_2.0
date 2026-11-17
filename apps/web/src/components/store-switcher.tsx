'use client';

import { Badge, Select } from '@/components/ui';
import { useStore } from '@/lib/store-context';

export function StoreSwitcher() {
  const { selectedStoreId, authorizedStores, canSelectAll, selectStore, isLoading } = useStore();

  if (isLoading) {
    return <span className="text-xs text-muted-foreground">Loading stores…</span>;
  }

  // Store Manager with exactly 1 assigned store: show an informative badge, no dropdown needed
  if (!canSelectAll && authorizedStores.length === 1 && authorizedStores[0]) {
    const store = authorizedStores[0];
    return (
      <div
        className="flex items-center gap-1.5"
        title={`Active Store: ${store.name} (${store.code})`}
      >
        <span className="text-xs text-muted-foreground hidden sm:inline">Store:</span>
        <Badge tone="info">
          {store.name} ({store.code})
        </Badge>
      </div>
    );
  }

  // Store Manager with no assigned stores yet
  if (!canSelectAll && authorizedStores.length === 0) {
    return (
      <span title="No stores assigned to your account in this project">
        <Badge tone="warning">No store assigned</Badge>
      </span>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className="text-xs text-muted-foreground hidden sm:inline">Store:</span>
      <Select
        aria-label="Store selector"
        className="h-8 w-auto max-w-[45vw] min-w-0 py-1 text-xs sm:max-w-[200px] sm:min-w-[130px]"
        value={selectedStoreId}
        onChange={(e) => selectStore(e.target.value)}
      >
        {canSelectAll && <option value="ALL">All Stores (Aggregated)</option>}
        {authorizedStores.map((store) => (
          <option key={store.id} value={store.id}>
            {store.name} ({store.code})
          </option>
        ))}
      </Select>
    </div>
  );
}
