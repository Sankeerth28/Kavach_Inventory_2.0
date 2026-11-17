'use client';

import type { AiCallStatus } from '@kavach/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  ListState,
  PageHeader,
  Select,
  Table,
  Td,
} from '@/components/ui';
import { api, errorMessage, useSession } from '@/lib/session';

const STATUS: Record<AiCallStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  SUCCESS: { label: 'Read', tone: 'success' },
  INVALID_OUTPUT: { label: 'Unusable answer', tone: 'warning' },
  PROVIDER_ERROR: { label: 'Service error', tone: 'danger' },
  TIMEOUT: { label: 'Timed out', tone: 'danger' },
  REFUSED: { label: 'Refused', tone: 'danger' },
};

const STAGE = {
  QUALITY_CHECK: 'Quality check',
  EXTRACTION: 'Reading document',
  MATCH_TIEBREAK: 'Choosing between materials',
} as const;

/**
 * AI Processing Logs (PRD §3.1 "View All", §3.2 "View Own Activity", §5.1 E).
 * Every call to the AI service is listed. The log cannot be edited.
 */
export default function AiProcessingPage() {
  const { can } = useSession();
  const all = can('ai_log:view_all');
  const [status, setStatus] = useState<AiCallStatus | ''>('');
  const [page, setPage] = useState(1);
  const overview = useQuery({ queryKey: ['ai-overview'], queryFn: api.aiLogs.overview });
  const logs = useQuery({
    queryKey: ['ai-logs', status, page],
    queryFn: () => api.aiLogs.list({ status: status || undefined, page, pageSize: 50 }),
  });
  const o = overview.data;
  const pages = logs.data ? Math.max(1, Math.ceil(logs.data.total / logs.data.pageSize)) : 1;

  return (
    <>
      <PageHeader
        title="AI Processing"
        description={
          all
            ? 'Every document read by the AI in this project.'
            : 'Documents you uploaded and how the AI read them.'
        }
      />
      {overview.error && <Alert>{errorMessage(overview.error)}</Alert>}
      {o && (
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ['Invoices processed', o.invoicesProcessed],
            ['Successful extractions', o.successfulExtractions],
            ['Matched materials', o.matchedLines],
            ['New materials created', o.newMaterialsCreated],
            ['Items requiring review', o.linesNeedingReview],
            ['Failed processing attempts', o.failedAttempts],
          ].map(([label, value]) => (
            <Card key={label} className="p-4">
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="mt-1 text-2xl font-semibold">{value}</p>
            </Card>
          ))}
        </div>
      )}

      <div className="mb-3 flex items-center gap-2">
        <Select
          aria-label="Result"
          className="w-52"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as AiCallStatus | '');
            setPage(1);
          }}
        >
          <option value="">All results</option>
          {(Object.keys(STATUS) as AiCallStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s].label}
            </option>
          ))}
        </Select>
      </div>
      <ListState
        loading={logs.isPending}
        error={logs.error ? errorMessage(logs.error) : null}
        empty={logs.data?.items.length === 0}
        emptyText="No AI activity yet."
      />
      {logs.data && logs.data.items.length > 0 && (
        <>
          <Table
            head={[
              'When',
              'Document',
              'Step',
              'Result',
              'Service',
              'Time',
              'Tokens',
              'Uploaded by',
            ]}
          >
            {logs.data.items.map((l) => (
              <tr key={l.id}>
                <Td className="text-xs whitespace-nowrap text-muted-foreground">
                  {new Date(l.createdAt).toLocaleString()}
                </Td>
                <Td>
                  {l.invoiceId ? (
                    <Link
                      className="text-primary hover:underline"
                      href={`/material-in/invoices/${l.invoiceId}`}
                    >
                      {l.invoiceNo ?? 'Open document'}
                    </Link>
                  ) : (
                    '—'
                  )}
                  {l.lineNo && (
                    <span className="text-xs text-muted-foreground"> · line {l.lineNo}</span>
                  )}
                </Td>
                <Td>
                  {STAGE[l.stage]}
                  {l.attempt > 1 && (
                    <span className="text-xs text-muted-foreground"> (attempt {l.attempt})</span>
                  )}
                </Td>
                <Td>
                  <Badge tone={STATUS[l.status].tone}>{STATUS[l.status].label}</Badge>
                  {l.errorMessage && (
                    <div className="mt-1 max-w-xs text-xs text-muted-foreground">
                      {l.errorMessage}
                    </div>
                  )}
                </Td>
                <Td className="text-xs">
                  {l.provider} / {l.model}
                  <div className="text-muted-foreground">{l.promptVersion}</div>
                </Td>
                <Td>{(l.latencyMs / 1000).toFixed(1)} s</Td>
                <Td className="text-xs">
                  {l.inputTokens !== null
                    ? `${l.inputTokens} in / ${l.outputTokens ?? 0} out`
                    : '—'}
                </Td>
                <Td>{l.triggeredByName}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {logs.data.total} call(s) · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={page >= pages}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
