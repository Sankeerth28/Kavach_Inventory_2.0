import type { StockStatus } from '@kavach/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import { STOCK_STATUS, TXN_LABEL, movement, when } from '../lib/data';
import { useNav } from '../lib/nav';
import { useSession } from '../lib/session';
import {
  Badge,
  Banner,
  Button,
  Card,
  Empty,
  Loading,
  Row,
  Screen,
  Segments,
  colors,
  styles,
} from '../ui';

type Filter = 'ALL' | Extract<StockStatus, 'LOW' | 'OUT'>;

/** Mobile Stock (PRD §21.4): search, list, available quantity and status for the selected store. */
export function StockScreen() {
  const nav = useNav();
  const { store } = useSession();
  const [typed, setTyped] = useState('');
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('ALL');

  // Search as the user types, but not on every key press (slow networks).
  useEffect(() => {
    const t = setTimeout(() => setQ(typed.trim()), 350);
    return () => clearTimeout(t);
  }, [typed]);

  const list = useQuery({
    queryKey: ['stock', 'list', store?.id, q, filter],
    queryFn: () =>
      api.stock.list({
        storeId: store?.id,
        q: q || undefined,
        status: filter === 'ALL' ? undefined : filter,
        pageSize: 100,
      }),
    enabled: !!store,
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];

  return (
    <Screen title="Stock" subtitle={store ? `Store: ${store.name}` : undefined} scroll={false}>
      <TextInput
        accessibilityLabel="Search materials"
        placeholder="Search by name or code"
        placeholderTextColor={colors.muted}
        value={typed}
        onChangeText={setTyped}
        autoCorrect={false}
        style={styles.input}
      />
      <Segments<Filter>
        label="Show"
        value={filter}
        options={[
          { id: 'ALL', label: 'All' },
          { id: 'LOW', label: 'Low stock' },
          { id: 'OUT', label: 'Out of stock' },
        ]}
        onChange={setFilter}
      />
      {list.error ? <Banner>{errorMessage(list.error)}</Banner> : null}
      {list.isPending ? (
        <Loading />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.materialId}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
          ListEmptyComponent={
            <Empty text={q ? 'No material matches your search.' : 'No materials here yet.'} />
          }
          ListFooterComponent={
            list.data && list.data.total > rows.length ? (
              <Text style={styles.hint}>
                Showing {rows.length} of {list.data.total}. Search to narrow the list.
              </Text>
            ) : undefined
          }
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${item.materialName}, ${item.availableQty} ${item.unitCode} available`}
              onPress={() => nav.push({ name: 'stockDetail', materialId: item.materialId })}
            >
              <Card>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={[styles.text, { flex: 1, fontWeight: '700' }]}>
                    {item.materialName}
                  </Text>
                  <Badge
                    label={STOCK_STATUS[item.status].label}
                    tone={STOCK_STATUS[item.status].tone}
                  />
                </View>
                <Text style={styles.hint}>
                  {[item.materialCode, item.brand, item.grade, item.size]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
                <Text style={styles.mono}>
                  {item.availableQty} {item.unitCode} available
                </Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </Screen>
  );
}

/** Material details (PRD §21.4, §16.4): the three kinds of stock, by store, and recent movement. */
export function StockDetailScreen({ materialId }: { materialId: string }) {
  const nav = useNav();
  const session = useSession();
  const detail = useQuery({
    queryKey: ['stock', 'detail', materialId],
    queryFn: () => api.stock.getDetail(materialId),
  });
  const d = detail.data;
  const here = d?.stores.find((s) => s.storeId === session.store?.id);

  if (detail.isPending) {
    return (
      <Screen title="Material">
        <Loading />
      </Screen>
    );
  }
  if (!d) {
    return (
      <Screen title="Material">
        <Banner>{errorMessage(detail.error)}</Banner>
        <Button label="Try again" variant="secondary" onPress={() => void detail.refetch()} />
      </Screen>
    );
  }

  return (
    <Screen
      title={d.materialName}
      subtitle={[d.materialCode, d.categoryName, d.brand, d.grade, d.size]
        .filter(Boolean)
        .join(' · ')}
      footer={
        session.can('material_out:create') && d.status !== 'INACTIVE' ? (
          <Button
            label="Issue this material"
            big
            disabled={!here || Number(here.availableQty) <= 0}
            onPress={() => nav.push({ name: 'materialOut', materialId })}
          />
        ) : undefined
      }
    >
      <Badge label={STOCK_STATUS[d.status].label} tone={STOCK_STATUS[d.status].tone} />
      <Card>
        <Text style={styles.h2}>{session.store ? session.store.name : 'This store'}</Text>
        <Row label="Available" value={`${here?.availableQty ?? '0'} ${d.unitCode}`} />
        <Row label="Damaged (not usable)" value={`${here?.damagedQty ?? '0'} ${d.unitCode}`} />
        <Row label="Scrap" value={`${here?.scrapQty ?? '0'} ${d.unitCode}`} />
      </Card>
      <Card>
        <Row
          label="Available in the whole project"
          value={`${d.projectAvailableQty} ${d.unitCode}`}
        />
        <Row
          label="Minimum stock"
          value={d.minimumStock ? `${d.minimumStock} ${d.unitCode}` : 'Not set'}
        />
      </Card>
      {d.stores.length > 1 ? (
        <Card>
          <Text style={styles.h2}>By store</Text>
          {d.stores.map((s) => (
            <Row key={s.storeId} label={s.storeName} value={`${s.availableQty} ${d.unitCode}`} />
          ))}
        </Card>
      ) : null}

      <Text style={styles.h2}>Recent movement</Text>
      {d.recent.length === 0 ? <Empty text="No transactions yet." /> : null}
      {d.recent.map((t) => (
        <Card key={t.id}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={[styles.text, { flex: 1, fontWeight: '600' }]}>{TXN_LABEL[t.type]}</Text>
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
            {t.txnNo} · {when(t.createdAt)} · {t.storeName}
            {t.bucket !== 'AVAILABLE' ? ` · ${t.bucket.toLowerCase()}` : ''}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
