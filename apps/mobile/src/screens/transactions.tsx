import type { PostingDto, TxnType } from '@kavach/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { api, errorMessage } from '../lib/api';
import { TXN_LABEL, movement, when } from '../lib/data';
import { useNav } from '../lib/nav';
import { useSession } from '../lib/session';
import { Banner, Button, Card, Empty, Loading, Row, Screen, Segments, colors, styles } from '../ui';

type Filter = 'ALL' | Extract<TxnType, 'MATERIAL_IN' | 'MATERIAL_OUT' | 'MATERIAL_RETURN'>;
const PAGE = 30;

/** Transaction history of the selected store (PRD §18.2), newest first. */
export function TransactionsScreen() {
  const { store } = useSession();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [size, setSize] = useState(PAGE);
  const list = useQuery({
    queryKey: ['transactions', 'list', store?.id, filter, size],
    queryFn: () =>
      api.transactions.list({
        storeId: store?.id,
        type: filter === 'ALL' ? undefined : filter,
        pageSize: size,
      }),
    enabled: !!store,
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];

  return (
    <Screen title="Transactions" subtitle={store ? `Store: ${store.name}` : undefined}>
      <Segments<Filter>
        label="Show"
        value={filter}
        options={[
          { id: 'ALL', label: 'All' },
          { id: 'MATERIAL_IN', label: 'In' },
          { id: 'MATERIAL_OUT', label: 'Out' },
          { id: 'MATERIAL_RETURN', label: 'Returns' },
        ]}
        onChange={(f) => {
          setFilter(f);
          setSize(PAGE);
        }}
      />
      {list.error ? <Banner>{errorMessage(list.error)}</Banner> : null}
      {list.isPending ? <Loading /> : null}
      {list.data && rows.length === 0 ? <Empty text="No transactions yet." /> : null}
      {rows.map((t) => (
        <Card key={t.id}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={[styles.text, { flex: 1, fontWeight: '700' }]}>{t.materialName}</Text>
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
            {TXN_LABEL[t.type]}
            {t.bucket !== 'AVAILABLE' ? ` (${t.bucket.toLowerCase()})` : ''} · {t.txnNo} ·{' '}
            {when(t.createdAt)}
          </Text>
          <Text style={styles.hint}>
            {[t.locationPath, t.contractorName, t.supplierName, t.createdByName]
              .filter(Boolean)
              .join(' · ')}
            {t.status === 'REVERSED' ? ' · Reversed' : ''}
          </Text>
        </Card>
      ))}
      {list.data && list.data.total > rows.length && size < 500 ? (
        <Button
          label="Show more"
          variant="secondary"
          busy={list.isFetching}
          onPress={() => setSize((s) => Math.min(500, s + PAGE))}
        />
      ) : null}
    </Screen>
  );
}

/** Shown after every posting: a clear success message with the reference number (PRD §21.5). */
export function PostedScreen({ posting, title }: { posting: PostingDto; title: string }) {
  const nav = useNav();
  return (
    <Screen
      title={title}
      footer={
        <>
          <Button label="Done" big onPress={nav.home} />
          {posting.type === 'ISSUE' ? (
            <Button
              label="Issue more"
              variant="secondary"
              onPress={() => nav.replace({ name: 'materialOut' })}
            />
          ) : null}
          {posting.type === 'RETURN' ? (
            <Button
              label="Return more"
              variant="secondary"
              onPress={() => nav.replace({ name: 'materialReturn' })}
            />
          ) : null}
          {posting.type.startsWith('RECEIPT') ? (
            <Button
              label="Receive more"
              variant="secondary"
              onPress={() => nav.replace({ name: 'materialIn' })}
            />
          ) : null}
        </>
      }
    >
      <Banner tone="success" title="Saved">
        <Text style={styles.bannerText}>
          {posting.referenceNo} · {when(posting.postedAt)}
        </Text>
      </Banner>
      {posting.warnings.map((w) => (
        <Banner key={w.code} tone="warning" title="Please check">
          {w.message}
        </Banner>
      ))}
      <Card>
        <Row label="Store" value={posting.storeName} />
        {posting.supplierName ? <Row label="Supplier" value={posting.supplierName} /> : null}
        {posting.externalRef ? <Row label="Document number" value={posting.externalRef} /> : null}
        {posting.lines[0]?.locationPath ? (
          <Row label="Location" value={posting.lines[0].locationPath} />
        ) : null}
        {posting.lines[0]?.contractorName ? (
          <Row label="Contractor" value={posting.lines[0].contractorName} />
        ) : null}
        <Row label="By" value={posting.postedByName} />
      </Card>
      <Text style={styles.h2}>Stock changes</Text>
      {posting.lines.map((t) => (
        <Card key={t.id}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Text style={[styles.text, { flex: 1, fontWeight: '700' }]}>{t.materialName}</Text>
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
            {t.bucket === 'AVAILABLE'
              ? 'Available stock'
              : t.bucket === 'DAMAGED'
                ? 'Damaged stock (not usable)'
                : 'Scrap'}{' '}
            · now {t.balanceAfter} {t.unitCode}
            {t.enteredQuantity && t.enteredUnitCode
              ? ` · entered as ${t.enteredQuantity} ${t.enteredUnitCode}`
              : ''}
          </Text>
        </Card>
      ))}
    </Screen>
  );
}
