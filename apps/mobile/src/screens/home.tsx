import { useQuery } from '@tanstack/react-query';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import { STOCK_STATUS, TXN_LABEL, movement, when } from '../lib/data';
import { useNav } from '../lib/nav';
import { useSession } from '../lib/session';
import { Badge, Banner, Button, Card, Empty, Picker, Screen, colors, styles } from '../ui';

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Store Manager Home (PRD §21.1, §5.2): four large actions, then today's activity, low stock and
 * recent transactions for the selected store.
 */
export function HomeScreen() {
  const nav = useNav();
  const session = useSession();
  const { store, stores, membership, me } = session;
  const storeId = store?.id;
  const canIn = session.can('material_in:create');
  const canOut = session.can('material_out:create');
  const canReturn = session.can('material_return:create');

  const today = useQuery({
    queryKey: ['home', 'today', storeId],
    queryFn: () => api.transactions.list({ storeId, from: startOfToday(), pageSize: 200 }),
    enabled: !!storeId,
  });
  const recent = useQuery({
    queryKey: ['transactions', 'recent', storeId],
    queryFn: () => api.transactions.list({ storeId, pageSize: 8 }),
    enabled: !!storeId,
  });
  const low = useQuery({
    queryKey: ['stock', 'low', storeId],
    queryFn: async () => {
      const [lowRows, out] = await Promise.all([
        api.stock.list({ storeId, status: 'LOW', pageSize: 50 }),
        api.stock.list({ storeId, status: 'OUT', pageSize: 50 }),
      ]);
      return [...out.items, ...lowRows.items];
    },
    enabled: !!storeId,
  });
  const pending = useQuery({
    queryKey: ['invoices', 'review', storeId],
    queryFn: () => api.invoices.list({ group: 'REVIEW', storeId, pageSize: 20 }),
    enabled: !!storeId && session.can('material_in:view'),
  });

  const rows = today.data?.items ?? [];
  const count = (type: string) => rows.filter((t) => t.type === type).length;
  const error = today.error ?? recent.error ?? low.error;

  const actions = [
    {
      label: 'Material In',
      hint: 'Scan invoice',
      route: { name: 'materialIn' } as const,
      show: canIn,
      color: '#0f766e',
    },
    {
      label: 'Material Out',
      hint: 'Issue to site',
      route: { name: 'materialOut' } as const,
      show: canOut,
      color: '#0e7490',
    },
    {
      label: 'Return',
      hint: 'From site',
      route: { name: 'materialReturn' } as const,
      show: canReturn,
      color: '#115e59',
    },
    {
      label: 'View Stock',
      hint: 'Search materials',
      route: { name: 'stock' } as const,
      show: true,
      color: '#134e4a',
    },
  ].filter((a) => a.show);

  return (
    <Screen
      title={membership?.projectName ?? 'KAVACH'}
      subtitle={`${me?.user.name ?? ''} · ${membership?.roleName ?? ''}`}
    >
      {stores.length > 1 ? (
        <Picker
          label="Store"
          value={storeId ?? null}
          options={stores.map((s) => ({ id: s.id, label: s.name, detail: s.code }))}
          onChange={session.selectStore}
        />
      ) : store ? (
        <Text style={styles.subtitle}>Store: {store.name}</Text>
      ) : (
        <Banner tone="warning">No store is assigned to you. Ask your Project Admin.</Banner>
      )}

      <View style={local.grid}>
        {actions.map((a) => (
          <Pressable
            key={a.label}
            accessibilityRole="button"
            accessibilityLabel={a.label}
            disabled={!store}
            onPress={() => nav.push(a.route)}
            style={({ pressed }) => [
              local.action,
              { backgroundColor: a.color, opacity: !store ? 0.5 : pressed ? 0.85 : 1 },
            ]}
          >
            <Text style={local.actionLabel}>{a.label}</Text>
            <Text style={local.actionHint}>{a.hint}</Text>
          </Pressable>
        ))}
      </View>

      {error ? <Banner>{errorMessage(error)}</Banner> : null}

      {(pending.data?.total ?? 0) > 0 && canIn ? (
        <Banner tone="info" title="Documents ready for review">
          <Text style={styles.bannerText}>
            {pending.data!.total} scanned document{pending.data!.total === 1 ? ' is' : 's are'} read
            and waiting to be received.
          </Text>
          <Button
            label="Review now"
            variant="secondary"
            onPress={() => nav.push({ name: 'materialIn' })}
          />
        </Banner>
      ) : null}

      <Text style={styles.h2}>Today&apos;s activity</Text>
      <View style={local.stats}>
        {[
          ['Receipts', count('MATERIAL_IN')],
          ['Issues', count('MATERIAL_OUT')],
          ['Returns', count('MATERIAL_RETURN')],
        ].map(([label, n]) => (
          <View key={label} style={local.stat}>
            <Text style={local.statValue}>{today.isPending ? '–' : n}</Text>
            <Text style={styles.hint}>{label}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.h2}>Low stock</Text>
      {low.data && low.data.length === 0 ? <Empty text="Nothing is running low." /> : null}
      {(low.data ?? []).slice(0, 6).map((r) => (
        <Pressable
          key={r.materialId}
          accessibilityRole="button"
          onPress={() => nav.push({ name: 'stockDetail', materialId: r.materialId })}
        >
          <Card>
            <View style={local.line}>
              <Text style={[styles.text, { flex: 1, fontWeight: '600' }]}>{r.materialName}</Text>
              <Badge label={STOCK_STATUS[r.status].label} tone={STOCK_STATUS[r.status].tone} />
            </View>
            <Text style={styles.hint}>
              {r.projectAvailableQty} {r.unitCode} in the project · minimum {r.minimumStock ?? '—'}
            </Text>
          </Card>
        </Pressable>
      ))}

      <Text style={styles.h2}>Recent transactions</Text>
      {recent.data && recent.data.items.length === 0 ? <Empty text="No transactions yet." /> : null}
      {(recent.data?.items ?? []).map((t) => (
        <Card key={t.id}>
          <View style={local.line}>
            <Text style={[styles.text, { flex: 1, fontWeight: '600' }]}>{t.materialName}</Text>
            <Text
              style={[
                styles.mono,
                { color: Number(t.quantity) > 0 ? colors.success : colors.danger },
              ]}
            >
              {movement(t)}
            </Text>
          </View>
          <Text style={styles.hint}>
            {TXN_LABEL[t.type]} · {when(t.createdAt)} · {t.createdByName}
          </Text>
        </Card>
      ))}
      <Button
        label="All transactions"
        variant="secondary"
        onPress={() => nav.push({ name: 'transactions' })}
      />
      {session.can('report:view_all') || session.can('report:view_operational') ? (
        <Button label="Reports" variant="secondary" onPress={() => nav.push({ name: 'reports' })} />
      ) : null}

      {(me?.memberships.length ?? 0) > 1 ? (
        <Picker
          label="Project"
          value={membership?.projectId ?? null}
          options={(me?.memberships ?? []).map((m) => ({
            id: m.projectId,
            label: m.projectName,
            detail: m.roleName,
          }))}
          onChange={session.selectProject}
        />
      ) : null}
      <Button label="Sign out" variant="ghost" onPress={() => void session.logout()} />
    </Screen>
  );
}

const local = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  action: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 110,
    borderRadius: 16,
    padding: 16,
    justifyContent: 'flex-end',
  },
  actionLabel: { color: '#fff', fontSize: 20, fontWeight: '800' },
  actionHint: { color: '#ffffffcc', fontSize: 14, marginTop: 2 },
  stats: { flexDirection: 'row', gap: 12 },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    alignItems: 'center',
  },
  statValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  line: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
