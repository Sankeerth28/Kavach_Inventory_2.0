'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { Badge, Card, ListState, PageHeader } from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';

/** Reports (PRD §19). The list comes from the server: it decides what this role may open. */
export default function ReportsPage() {
  const { can } = useSession();
  const list = useQuery({ queryKey: ['reports'], queryFn: api.reports.list });
  const all = can('report:view_all');

  return (
    <>
      <PageHeader
        title="Reports"
        description={
          all
            ? 'All reports for the project. Choose dates and stores, then download Excel or PDF.'
            : 'Reports for your stores. Choose dates, then download Excel or PDF.'
        }
      />
      <ListState
        loading={list.isPending}
        error={list.error ? errorMessage(list.error) : null}
        empty={list.data?.length === 0}
        emptyText="No reports are available to you."
      />
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {(list.data ?? []).map((r) => (
          <Link key={r.key} href={`/reports/${r.key}`} className="group">
            <Card className="h-full p-4 transition group-hover:border-primary/60">
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-semibold">{r.title}</h2>
                {all && !r.operational && <Badge tone="info">Admin</Badge>}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{r.description}</p>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
