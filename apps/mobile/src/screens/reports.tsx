import {
  REPORTS,
  type ReportDto,
  type ReportFormat,
  type ReportKey,
  type ReportQueryInput,
  formatReportCell,
} from '@kavach/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import { useNav } from '../lib/nav';
import { useSession } from '../lib/session';
import { Banner, Button, Card, Empty, Loading, Row, Screen, Segments, styles } from '../ui';

type Period = 'today' | '7' | '30' | '90';

function isoDay(d: Date): string {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return z.toISOString().slice(0, 10);
}

function range(period: Period): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (period !== 'today') from.setDate(from.getDate() - (Number(period) - 1));
  return { from: isoDay(from), to: isoDay(to) };
}

/** The reports a member may open on the phone: the server's list (PRD §19, DECISIONS Q18). */
export function ReportsScreen() {
  const nav = useNav();
  const list = useQuery({ queryKey: ['reports'], queryFn: api.reports.list });
  return (
    <Screen title="Reports" subtitle="For the store you are working in">
      {list.error ? <Banner>{errorMessage(list.error)}</Banner> : null}
      {list.isPending ? <Loading /> : null}
      {list.data && list.data.length === 0 ? (
        <Empty text="No reports are available to you." />
      ) : null}
      {(list.data ?? []).map((r) => (
        <Pressable
          key={r.key}
          accessibilityRole="button"
          accessibilityLabel={r.title}
          onPress={() => nav.push({ name: 'report', key: r.key })}
        >
          <Card>
            <Text style={[styles.text, { fontWeight: '700' }]}>{r.title}</Text>
            <Text style={styles.hint}>{r.description}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}

/** Columns worth a line on a small card; the rest is in the downloaded file. */
function headline(report: ReportDto) {
  const pick = (keys: string[]) => report.columns.filter((c) => keys.includes(c.key));
  const title = pick(['material', 'supplier'])[0];
  const detail = report.columns.filter(
    (c) => c.key !== title?.key && !['code', 'notes', 'txn', 'by'].includes(c.key),
  );
  return { title, detail: detail.slice(0, 6) };
}

/** One report: period, list of rows as cards, and the file to share (PRD §19 export). */
export function ReportScreen({ reportKey }: { reportKey: ReportKey }) {
  const session = useSession();
  const def = REPORTS[reportKey];
  const usesDates = def.filters.includes('dates');
  const [period, setPeriod] = useState<Period>('30');
  const [sharing, setSharing] = useState<ReportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query: ReportQueryInput = {
    ...(usesDates ? range(period) : {}),
    ...(def.filters.includes('store') && session.store ? { storeId: session.store.id } : {}),
  };
  const report = useQuery({
    queryKey: ['report', reportKey, query],
    queryFn: () => api.reports.run(reportKey, query),
    placeholderData: keepPreviousData,
  });

  const share = async (format: ReportFormat) => {
    setSharing(format);
    setError(null);
    try {
      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('This phone cannot share files. Download the report in the web app.');
      }
      // The file is fetched with the session header; the token never goes into a link.
      const source = await api.reports.exportSource(reportKey, query, format);
      const target = new File(Paths.cache, `kavach-${reportKey}-${isoDay(new Date())}.${format}`);
      const file = await File.downloadFileAsync(source.uri, target, {
        headers: source.headers,
        idempotent: true,
      });
      await Sharing.shareAsync(file.uri, {
        mimeType:
          format === 'pdf'
            ? 'application/pdf'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        dialogTitle: def.title,
      });
    } catch (e) {
      setError(e instanceof Error && !('code' in e) ? e.message : errorMessage(e));
    } finally {
      setSharing(null);
    }
  };

  const data = report.data;
  const shape = data ? headline(data) : null;
  const canExport = session.can('report:export');

  return (
    <Screen
      title={def.title}
      subtitle={session.store ? `Store: ${session.store.name}` : undefined}
      footer={
        canExport ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                label={sharing === 'pdf' ? 'Preparing…' : 'Share PDF'}
                variant="secondary"
                disabled={!data || sharing !== null}
                onPress={() => void share('pdf')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={sharing === 'xlsx' ? 'Preparing…' : 'Share Excel'}
                variant="secondary"
                disabled={!data || sharing !== null}
                onPress={() => void share('xlsx')}
              />
            </View>
          </View>
        ) : undefined
      }
    >
      <Text style={styles.hint}>{def.description}</Text>
      {usesDates ? (
        <Segments<Period>
          label="Period"
          value={period}
          options={[
            { id: 'today', label: 'Today' },
            { id: '7', label: '7 days' },
            { id: '30', label: '30 days' },
            { id: '90', label: '90 days' },
          ]}
          onChange={setPeriod}
        />
      ) : null}
      {error ? <Banner>{error}</Banner> : null}
      {report.error ? <Banner>{errorMessage(report.error)}</Banner> : null}
      {report.isPending ? <Loading /> : null}
      {data?.truncated ? (
        <Banner tone="warning">
          Only the first {data.rows.length} rows are shown. Share the file for more.
        </Banner>
      ) : null}
      {data && data.rows.length === 0 ? <Empty text="Nothing for this period." /> : null}
      {data && shape
        ? data.rows.slice(0, 200).map((row, i) => (
            <Card key={i}>
              {shape.title ? (
                <Text style={[styles.text, { fontWeight: '700' }]}>
                  {formatReportCell(row[shape.title.key] ?? null, shape.title.kind, data.timezone)}
                </Text>
              ) : null}
              {shape.detail.map((c) => {
                const v = formatReportCell(row[c.key] ?? null, c.kind, data.timezone);
                return v ? <Row key={c.key} label={c.label} value={v} /> : null;
              })}
            </Card>
          ))
        : null}
      {data && data.rows.length > 200 ? (
        <Text style={styles.hint}>
          {data.rows.length - 200} more rows are in the file. Use Share PDF or Share Excel.
        </Text>
      ) : null}
      {data?.notes.map((n) => (
        <Text key={n} style={styles.hint}>
          • {n}
        </Text>
      ))}
    </Screen>
  );
}
