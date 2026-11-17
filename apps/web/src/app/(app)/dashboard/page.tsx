'use client';

import type { StockRowDto, TransactionDto } from '@kavach/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Badge, Button, Card, PageHeader, Table, Td } from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';
import { useStore } from '@/lib/store-context';
import { cn } from '@/lib/utils';

function StatCard({
  label,
  value,
  note,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  note?: string;
  tone?: 'default' | 'warning' | 'danger' | 'success';
}) {
  return (
    <Card
      className={cn(
        'p-4 transition-colors',
        tone === 'warning' && 'border-warning/40 bg-warning/5',
        tone === 'danger' && 'border-danger/40 bg-danger/5',
        tone === 'success' && 'border-success/40 bg-success/5',
      )}
    >
      <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums sm:text-3xl">{value}</p>
      {note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
    </Card>
  );
}

export default function DashboardPage() {
  const { membership, can } = useSession();
  const { selectedStoreId, selectedStore, allStores, isAllStores } = useStore();

  const isFullView = can('dashboard:view_full');
  const isOperationalView = can('dashboard:view_operational');

  // Master counts summary
  const summaryQuery = useQuery({
    queryKey: ['dashboard', membership?.projectId],
    queryFn: api.dashboard.get,
    enabled: !!membership?.projectId,
  });

  // AI processing overview (PRD §5.1 E): the project for an admin, own uploads for a Store Manager
  const aiQuery = useQuery({
    queryKey: ['ai-overview', membership?.projectId],
    queryFn: api.aiLogs.overview,
    enabled: !!membership?.projectId,
  });
  const ai = aiQuery.data;

  // Stock rows for the active store (or project-wide if ALL)
  const stockQuery = useQuery({
    queryKey: ['stock', membership?.projectId, selectedStoreId],
    queryFn: () =>
      api.stock.list({
        storeId: selectedStoreId === 'ALL' ? undefined : selectedStoreId,
        page: 1,
        pageSize: 100,
      }),
    enabled: !!membership?.projectId,
  });

  // Recent transactions
  const txnsQuery = useQuery({
    queryKey: ['transactions', membership?.projectId, selectedStoreId],
    queryFn: () =>
      api.transactions.list({
        storeId: selectedStoreId === 'ALL' ? undefined : selectedStoreId,
        page: 1,
        pageSize: 8,
      }),
    enabled: !!membership?.projectId,
  });

  // Pending verifications (for Project Admin)
  const verificationsQuery = useQuery({
    queryKey: ['stock-verifications', 'pending', membership?.projectId],
    queryFn: () =>
      api.verifications.list({
        status: 'SUBMITTED',
        page: 1,
        pageSize: 5,
      }),
    enabled: !!membership?.projectId && isFullView,
  });

  const stockRows = stockQuery.data?.items ?? [];
  const inStockCount = stockRows.filter((r) => Number(r.availableQty) > 0).length;
  const lowStockRows = stockRows.filter((r) => r.status === 'LOW');
  const outOfStockRows = stockRows.filter((r) => r.status === 'OUT');

  // Count movements from today's transactions
  const recentTxns = txnsQuery.data?.items ?? [];
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayReceipts = recentTxns.filter(
    (t) =>
      t.createdAt.slice(0, 10) === todayStr &&
      (t.postingType === 'RECEIPT_MANUAL' ||
        t.postingType === 'RECEIPT_QUICK' ||
        t.postingType === 'RECEIPT_INVOICE'),
  ).length;
  const todayIssues = recentTxns.filter(
    (t) => t.createdAt.slice(0, 10) === todayStr && t.postingType === 'ISSUE',
  ).length;

  const pendingCount = verificationsQuery.data?.total ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={isFullView ? 'Project Dashboard' : 'Store Dashboard'}
        description={
          isFullView
            ? `Project-wide inventory oversight • ${membership?.projectName}`
            : `Operational store view: ${selectedStore ? `${selectedStore.name} (${selectedStore.code})` : 'All assigned stores'}`
        }
      />

      {summaryQuery.error && <Alert>{errorMessage(summaryQuery.error)}</Alert>}

      {/* Documents waiting for the Store Manager (PRD §10.2 "Pending Reviews") */}
      {isOperationalView && ai && ai.pendingReview > 0 && (
        <Alert tone="info" title="Scanned documents waiting for you">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              <strong>{ai.pendingReview}</strong> document{ai.pendingReview === 1 ? ' is' : 's are'}{' '}
              read and ready to be checked and received.
            </span>
            <Link href="/material-in">
              <Button size="sm" variant="secondary">
                Review →
              </Button>
            </Link>
          </div>
        </Alert>
      )}

      {/* E. AI Processing Overview (PRD §5.1 E) */}
      {isFullView && ai && (
        <Card className="p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">AI Processing Overview</h2>
            <Link href="/ai-processing" className="text-xs text-primary hover:underline">
              View AI processing →
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {[
              ['Invoices processed', ai.invoicesProcessed],
              ['Successful extractions', ai.successfulExtractions],
              ['Matched materials', ai.matchedLines],
              ['New materials created', ai.newMaterialsCreated],
              ['Items requiring review', ai.linesNeedingReview],
              ['Failed attempts', ai.failedAttempts],
            ].map(([label, value]) => (
              <div key={label} className="rounded-md bg-muted px-3 py-2">
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Admin pending verifications alert banner */}
      {isFullView && pendingCount > 0 && (
        <Alert tone="warning" title="Pending Stock Verifications">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              There {pendingCount === 1 ? 'is' : 'are'} <strong>{pendingCount}</strong> physical
              stock count {pendingCount === 1 ? 'submission' : 'submissions'} awaiting your
              approval.
            </span>
            <Link href="/stock-verification">
              <Button size="sm" variant="secondary">
                Review Counts →
              </Button>
            </Link>
          </div>
        </Alert>
      )}

      {/* Store Manager Operational 4 Prominent Actions (PRD §5.2, Q33) */}
      {isOperationalView && (
        <section aria-label="Quick Actions">
          <h2 className="mb-3 text-sm font-semibold tracking-tight text-muted-foreground uppercase">
            Quick Actions
          </h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Link href="/material-in" className="group">
              <Card className="flex h-32 flex-col justify-between p-4 transition-all hover:border-primary hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">📥</span>
                  <Badge tone="success">Inward</Badge>
                </div>
                <div>
                  <p className="font-semibold text-foreground group-hover:text-primary">
                    Material In
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                    Receive delivery challan or Quick Receive
                  </p>
                </div>
              </Card>
            </Link>

            <Link href="/material-out" className="group">
              <Card className="flex h-32 flex-col justify-between p-4 transition-all hover:border-primary hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">📤</span>
                  <Badge tone="info">Issue</Badge>
                </div>
                <div>
                  <p className="font-semibold text-foreground group-hover:text-primary">
                    Material Out
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                    Issue materials to site & contractors
                  </p>
                </div>
              </Card>
            </Link>

            <Link href="/material-return" className="group">
              <Card className="flex h-32 flex-col justify-between p-4 transition-all hover:border-primary hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">↩️</span>
                  <Badge tone="warning">Return</Badge>
                </div>
                <div>
                  <p className="font-semibold text-foreground group-hover:text-primary">
                    Return Material
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                    Reusable, damaged or scrap returns
                  </p>
                </div>
              </Card>
            </Link>

            <Link href="/stock" className="group">
              <Card className="flex h-32 flex-col justify-between p-4 transition-all hover:border-primary hover:shadow-md">
                <div className="flex items-center justify-between">
                  <span className="text-2xl">📦</span>
                  <Badge tone="neutral">Balances</Badge>
                </div>
                <div>
                  <p className="font-semibold text-foreground group-hover:text-primary">
                    View Stock
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                    Real-time available, damaged & scrap stock
                  </p>
                </div>
              </Card>
            </Link>
          </div>
        </section>
      )}

      {/* KPI Stats Grid */}
      <section aria-label="Stock Metrics">
        <h2 className="mb-3 text-sm font-semibold tracking-tight text-muted-foreground uppercase">
          {isAllStores
            ? 'Project-Wide Stock Overview'
            : `Stock Overview • ${selectedStore?.name ?? 'Store'}`}
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            label="Materials Tracked"
            value={stockRows.length || (summaryQuery.data?.materialCount ?? '0')}
            note={`${inStockCount} active in stock`}
          />
          <StatCard
            label="Low Stock Alerts"
            value={lowStockRows.length}
            tone={lowStockRows.length > 0 ? 'warning' : 'default'}
            note="Below safety threshold"
          />
          <StatCard
            label="Out of Stock"
            value={outOfStockRows.length}
            tone={outOfStockRows.length > 0 ? 'danger' : 'default'}
            note="Zero available balance"
          />
          <StatCard
            label="Today's Movements"
            value={`${todayReceipts} in / ${todayIssues} out`}
            note="Recent ledger postings"
          />
        </div>
      </section>

      {/* Project Admin: Store-wise Stock Overview */}
      {isFullView && (
        <section aria-label="Store-wise Overview">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">
              Store Breakdown ({allStores.length} stores)
            </h2>
            <Link href="/stores" className="text-xs text-primary hover:underline">
              Manage Stores →
            </Link>
          </div>
          <Table head={['Store Code', 'Store Name', 'Status', 'Actions']}>
            {allStores.map((store) => (
              <tr key={store.id} className="hover:bg-muted/40">
                <Td className="font-mono font-medium">{store.code}</Td>
                <Td className="font-medium">{store.name}</Td>
                <Td>
                  <Badge tone={store.isActive ? 'success' : 'neutral'}>
                    {store.isActive ? 'Active' : 'Inactive'}
                  </Badge>
                </Td>
                <Td>
                  <Link
                    href={`/stock?storeId=${store.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    View Store Stock →
                  </Link>
                </Td>
              </tr>
            ))}
          </Table>
        </section>
      )}

      {/* Two-column layout: Low Stock Alerts + Recent Transactions */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Low Stock Alerts */}
        <section aria-label="Low Stock Alerts">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">
              Low Stock Alerts ({lowStockRows.length})
            </h2>
            <Link href="/stock?status=LOW" className="text-xs text-primary hover:underline">
              View all stock →
            </Link>
          </div>
          {lowStockRows.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              ✓ No materials currently below minimum stock threshold.
            </Card>
          ) : (
            <Table head={['Code', 'Material', 'Available', 'Status']}>
              {lowStockRows.slice(0, 5).map((row: StockRowDto) => (
                <tr key={row.materialId} className="hover:bg-muted/40">
                  <Td className="font-mono text-xs font-medium">{row.materialCode}</Td>
                  <Td>
                    <p className="font-medium leading-tight">{row.materialName}</p>
                    <p className="text-xs text-muted-foreground">{row.categoryName}</p>
                  </Td>
                  <Td className="tabular-nums font-semibold">
                    {row.availableQty} {row.unitCode}
                  </Td>
                  <Td>
                    <Badge tone="warning">LOW</Badge>
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </section>

        {/* Recent Transactions */}
        <section aria-label="Recent Transactions">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold tracking-tight text-muted-foreground uppercase">
              Recent Transactions
            </h2>
            <Link href="/transactions" className="text-xs text-primary hover:underline">
              Full Ledger →
            </Link>
          </div>
          {recentTxns.length === 0 ? (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No transactions recorded yet.
            </Card>
          ) : (
            <Table head={['Txn #', 'Type', 'Material', 'Quantity', 'Time']}>
              {recentTxns.slice(0, 5).map((txn: TransactionDto) => (
                <tr key={txn.id} className="hover:bg-muted/40">
                  <Td className="font-mono text-xs">{txn.txnNo}</Td>
                  <Td>
                    <Badge
                      tone={
                        txn.postingType === 'RECEIPT_MANUAL' ||
                        txn.postingType === 'RECEIPT_QUICK' ||
                        txn.postingType === 'RECEIPT_INVOICE'
                          ? 'success'
                          : txn.postingType === 'ISSUE'
                            ? 'info'
                            : txn.postingType === 'RETURN'
                              ? 'warning'
                              : 'neutral'
                      }
                    >
                      {txn.postingType}
                    </Badge>
                  </Td>
                  <Td className="max-w-[140px] truncate">{txn.materialName}</Td>
                  <Td className="tabular-nums font-mono text-xs">
                    {txn.quantity} {txn.unitCode}
                  </Td>
                  <Td className="text-xs text-muted-foreground">
                    {new Date(txn.createdAt).toLocaleDateString([], {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </section>
      </div>
    </div>
  );
}
