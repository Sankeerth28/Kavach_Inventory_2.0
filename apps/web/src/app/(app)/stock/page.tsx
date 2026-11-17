'use client';

import type { StockRowDto, StockStatus } from '@kavach/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Field,
  Input,
  ListState,
  PageHeader,
  Select,
  Table,
  Td,
} from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';
import { useStore } from '@/lib/store-context';
import { cn } from '@/lib/utils';

export default function StockListPage() {
  const { can } = useSession();
  const { selectedStoreId, selectedStore } = useStore();

  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<StockStatus | 'ALL'>('ALL');
  const [reconcileResult, setReconcileResult] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);

  const categoriesQuery = useQuery({ queryKey: ['categories'], queryFn: api.categories.list });
  const categories = categoriesQuery.data ?? [];

  const effectiveStoreId = selectedStoreId === 'ALL' ? undefined : selectedStoreId;

  const stockQuery = useQuery({
    queryKey: ['stock', effectiveStoreId, categoryId, status, search],
    queryFn: () =>
      api.stock.list({
        storeId: effectiveStoreId,
        categoryId: categoryId || undefined,
        status: status === 'ALL' ? undefined : status,
        q: search.trim() || undefined,
        pageSize: 100,
      }),
  });

  const items = stockQuery.data?.items ?? [];

  const handleReconcile = async () => {
    setReconciling(true);
    setReconcileResult(null);
    try {
      const res = await api.stock.reconciliation();
      if (res.mismatches.length === 0) {
        setReconcileResult(
          `✓ All ${res.checkedBalances} stock balances match their ledger transactions perfectly. Zero discrepancies.`,
        );
      } else {
        setReconcileResult(
          `⚠️ Found ${res.mismatches.length} balance mismatch(es) against the ledger.`,
        );
      }
    } catch (err) {
      setReconcileResult(`Error: ${errorMessage(err)}`);
    } finally {
      setReconciling(false);
    }
  };

  const canReconcile = can('stock:reconcile');

  return (
    <div className="space-y-6">
      <PageHeader
        title="Current Stock"
        description={
          selectedStoreId === 'ALL'
            ? 'Project-wide aggregated stock across all stores and buckets.'
            : `Store stock: ${selectedStore?.name ?? 'Store'} (${selectedStore?.code ?? ''})`
        }
        actions={
          canReconcile ? (
            <Button variant="secondary" size="sm" onClick={handleReconcile} disabled={reconciling}>
              {reconciling ? 'Checking Ledger…' : '⚖️ Reconcile Ledger'}
            </Button>
          ) : undefined
        }
      />

      {reconcileResult && (
        <Alert
          tone={reconcileResult.startsWith('✓') ? 'success' : 'warning'}
          title="Ledger Reconciliation Result"
        >
          {reconcileResult}
        </Alert>
      )}

      {/* Filter Bar */}
      <Card className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <Field label="Search SKU / Code">
            {(id) => (
              <Input
                id={id}
                placeholder="Search material or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
          </Field>

          <Field label="Category">
            {(id) => (
              <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                <option value="">All Categories</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Stock Status">
            {(id) => (
              <Select
                id={id}
                value={status}
                onChange={(e) => setStatus(e.target.value as StockStatus | 'ALL')}
              >
                <option value="ALL">All Statuses</option>
                <option value="AVAILABLE">In Stock (Available)</option>
                <option value="LOW">Low Stock</option>
                <option value="OUT">Out of Stock</option>
                <option value="INACTIVE">Inactive SKUs</option>
              </Select>
            )}
          </Field>

          <div className="flex items-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-10 w-full"
              onClick={() => {
                setSearch('');
                setCategoryId('');
                setStatus('ALL');
              }}
            >
              Reset Filters
            </Button>
          </div>
        </div>
      </Card>

      {/* Stock Table */}
      <ListState
        loading={stockQuery.isLoading}
        error={stockQuery.error ? errorMessage(stockQuery.error) : null}
        empty={items.length === 0}
        emptyText="No material stock balances match the selected filters."
      />

      {items.length > 0 && (
        <Table
          head={[
            'Material Code',
            'Material Name',
            'Category',
            'Unit',
            'Available Stock',
            'Damaged',
            'Scrap',
            'Status',
            'Action',
          ]}
        >
          {items.map((row: StockRowDto) => {
            const avail = Number(row.availableQty);
            const damaged = Number(row.damagedQty);
            const scrap = Number(row.scrapQty);

            return (
              <tr key={row.materialId} className="hover:bg-muted/40">
                <Td className="font-mono text-xs font-semibold">{row.materialCode}</Td>
                <Td className="font-medium max-w-[200px] truncate">{row.materialName}</Td>
                <Td className="text-xs text-muted-foreground">{row.categoryName}</Td>
                <Td className="text-xs font-mono">{row.unitCode}</Td>
                <Td className="tabular-nums font-semibold text-foreground">
                  <span
                    className={cn(
                      'px-2 py-0.5 rounded text-sm',
                      avail > 0 ? 'bg-success/10 text-success' : 'text-muted-foreground',
                    )}
                  >
                    {row.availableQty}
                  </span>
                </Td>
                <Td className="tabular-nums text-xs">
                  {damaged > 0 ? (
                    <span className="font-medium text-warning bg-warning/10 px-2 py-0.5 rounded">
                      {row.damagedQty}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </Td>
                <Td className="tabular-nums text-xs">
                  {scrap > 0 ? (
                    <span className="font-medium text-danger bg-danger/10 px-2 py-0.5 rounded">
                      {row.scrapQty}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">0</span>
                  )}
                </Td>
                <Td>
                  <Badge
                    tone={
                      row.status === 'AVAILABLE'
                        ? 'success'
                        : row.status === 'LOW'
                          ? 'warning'
                          : row.status === 'OUT'
                            ? 'danger'
                            : 'neutral'
                    }
                  >
                    {row.status}
                  </Badge>
                </Td>
                <Td>
                  <Link
                    href={`/stock/${row.materialId}`}
                    className="text-xs text-primary font-medium hover:underline"
                  >
                    Details & Audit →
                  </Link>
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
