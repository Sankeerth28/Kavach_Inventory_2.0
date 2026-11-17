import { type InvoiceStatus, type InvoiceSummaryDto, UPLOAD_LIMITS } from '@kavach/shared';
import { useQuery } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { ApiError, api, errorMessage } from '../lib/api';
import { when } from '../lib/data';
import { useNav } from '../lib/nav';
import { refreshAfterPosting, useSession } from '../lib/session';
import { Badge, Banner, Button, Card, Screen, type Tone, colors, styles } from '../ui';

interface Page {
  uri: string;
  mimeType: string;
  name: string;
}

export const INVOICE_STATUS: Record<InvoiceStatus, { label: string; tone: Tone }> = {
  UPLOADING: { label: 'Uploading', tone: 'neutral' },
  QUEUED: { label: 'Waiting to be read', tone: 'neutral' },
  PROCESSING: { label: 'Being read', tone: 'neutral' },
  NEEDS_RECAPTURE: { label: 'Better photo needed', tone: 'warning' },
  READY_FOR_REVIEW: { label: 'Ready to review', tone: 'info' },
  POSTED: { label: 'Received', tone: 'success' },
  REVERSED: { label: 'Reversed', tone: 'neutral' },
  FAILED: { label: 'Could not be read', tone: 'danger' },
  DISCARDED: { label: 'Discarded', tone: 'neutral' },
};

function mimeOf(name: string, given: string | undefined): string {
  if (given && given !== 'application/octet-stream') return given;
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'png' ? 'image/png' : ext === 'pdf' ? 'application/pdf' : 'image/jpeg';
}

/**
 * Mobile Material In (PRD §21.2): scan the invoice or challan page by page, send it to be read,
 * then review and receive. The phone only captures and uploads; reading happens on the server.
 */
export function MaterialInScreen() {
  const nav = useNav();
  const session = useSession();
  const { store } = session;
  const canReceive = session.can('material_in:create');
  const [pages, setPages] = useState<Page[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const inbox = useQuery({
    queryKey: ['invoices', 'inbox', store?.id],
    queryFn: async () => {
      const [processing, review, problem] = await Promise.all([
        api.invoices.list({ group: 'PROCESSING', storeId: store?.id, pageSize: 20 }),
        api.invoices.list({ group: 'REVIEW', storeId: store?.id, pageSize: 20 }),
        api.invoices.list({ group: 'PROBLEM', storeId: store?.id, pageSize: 20 }),
      ]);
      return { processing: processing.items, review: review.items, problem: problem.items };
    },
    enabled: !!store,
    // Documents being read move on by themselves: look again every few seconds while any is.
    refetchInterval: (q) => ((q.state.data?.processing.length ?? 0) > 0 ? 4000 : false),
  });

  const add = (more: Page[]) => {
    setError(null);
    setPages((p) => {
      const all = [...p, ...more];
      if (all.length > UPLOAD_LIMITS.maxFiles)
        setError(`A document can have at most ${UPLOAD_LIMITS.maxFiles} files.`);
      return all.slice(0, UPLOAD_LIMITS.maxFiles);
    });
  };

  const scan = async () => {
    setError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError(
        'The camera is not allowed. Allow camera access for KAVACH in the phone settings, or choose a photo instead.',
      );
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (result.canceled) return;
    add(
      result.assets.map((a, i) => {
        const name = a.fileName ?? `page-${pages.length + i + 1}.jpg`;
        return { uri: a.uri, name, mimeType: mimeOf(name, a.mimeType) };
      }),
    );
  };

  const choosePhotos = async () => {
    setError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: UPLOAD_LIMITS.maxFiles,
    });
    if (result.canceled) return;
    add(
      result.assets.map((a, i) => {
        const name = a.fileName ?? `page-${pages.length + i + 1}.jpg`;
        return { uri: a.uri, name, mimeType: mimeOf(name, a.mimeType) };
      }),
    );
  };

  const choosePdf = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled) return;
    add(
      result.assets.map((a) => ({
        uri: a.uri,
        name: a.name,
        mimeType: mimeOf(a.name, a.mimeType),
      })),
    );
  };

  const send = async () => {
    if (!store || pages.length === 0) return;
    setError(null);
    let invoiceId: string | null = null;
    try {
      setProgress('Starting…');
      const created = await api.invoices.create(store.id);
      invoiceId = created.id;
      for (const [i, page] of pages.entries()) {
        setProgress(`Uploading page ${i + 1} of ${pages.length}…`);
        // The file is read from the phone and sent as it is; the server checks what it really is.
        const blob = await (await fetch(page.uri)).blob();
        if (blob.size > UPLOAD_LIMITS.maxFileBytes) {
          throw new Error(
            `Page ${i + 1} is larger than ${UPLOAD_LIMITS.maxFileBytes / 1024 / 1024} MB.`,
          );
        }
        await api.invoices.uploadPage(created.id, blob, page.mimeType, page.name);
      }
      setProgress('Sending to be read…');
      await api.invoices.submit(created.id);
      setPages([]);
      setProgress(null);
      refreshAfterPosting();
      nav.push({ name: 'invoice', id: created.id });
    } catch (e) {
      // A half-uploaded document is of no use: remove it. The pages stay on this screen to try again.
      if (invoiceId) void api.invoices.discard(invoiceId).catch(() => undefined);
      setProgress(null);
      setError(
        !(e instanceof ApiError) && e instanceof Error
          ? e.message
          : `${errorMessage(e)} Your pages are kept here: tap Read document to try again.`,
      );
    }
  };

  const row = (inv: InvoiceSummaryDto) => (
    <Pressable
      key={inv.id}
      accessibilityRole="button"
      onPress={() => nav.push({ name: 'invoice', id: inv.id })}
    >
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Text style={[styles.text, { flex: 1, fontWeight: '700' }]} numberOfLines={1}>
            {inv.supplierName ?? 'Document'} {inv.invoiceNo ?? inv.challanNo ?? ''}
          </Text>
          <Badge label={INVOICE_STATUS[inv.status].label} tone={INVOICE_STATUS[inv.status].tone} />
        </View>
        <Text style={styles.hint}>
          {inv.pageCount} page{inv.pageCount === 1 ? '' : 's'}
          {inv.lineCount > 0
            ? ` · ${inv.lineCount} line${inv.lineCount === 1 ? '' : 's'}`
            : ''} · {when(inv.createdAt)} · {inv.uploadedByName}
        </Text>
        {inv.status === 'FAILED' && inv.failureMessage ? (
          <Text style={[styles.hint, { color: colors.danger }]}>{inv.failureMessage}</Text>
        ) : null}
      </Card>
    </Pressable>
  );

  if (!store) {
    return (
      <Screen title="Material In">
        <Banner tone="warning">No store is selected.</Banner>
      </Screen>
    );
  }

  const busy = progress !== null;
  const data = inbox.data;

  return (
    <Screen
      title="Material In"
      subtitle={`Store: ${store.name}`}
      footer={
        pages.length > 0 ? (
          <>
            <Button
              label={
                busy
                  ? progress!
                  : `Read document (${pages.length} page${pages.length === 1 ? '' : 's'})`
              }
              big
              busy={false}
              disabled={busy}
              onPress={() => void send()}
            />
            <Button
              label="Start again"
              variant="ghost"
              disabled={busy}
              onPress={() => setPages([])}
            />
          </>
        ) : undefined
      }
    >
      {error ? <Banner>{error}</Banner> : null}

      {canReceive ? (
        <>
          <Button
            label={pages.length === 0 ? 'Scan Invoice' : 'Scan another page'}
            big
            disabled={busy}
            onPress={() => void scan()}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button
                label="Choose photos"
                variant="secondary"
                disabled={busy}
                onPress={() => void choosePhotos()}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label="Choose PDF"
                variant="secondary"
                disabled={busy}
                onPress={() => void choosePdf()}
              />
            </View>
          </View>
          {pages.length === 0 ? (
            <Text style={styles.hint}>
              Lay the paper flat in good light and fill the screen with it. Take one photo per page.
              Handwritten challans are fine.
            </Text>
          ) : null}
        </>
      ) : (
        <Banner tone="info">
          You can see documents here. Only a Store Manager can receive material.
        </Banner>
      )}

      {pages.length > 0 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {pages.map((p, i) => (
            <View key={`${p.uri}-${i}`} style={{ width: 104, gap: 4 }}>
              {p.mimeType === 'application/pdf' ? (
                <View
                  style={{
                    width: 104,
                    height: 138,
                    borderRadius: 8,
                    backgroundColor: colors.infoBg,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={styles.mono}>PDF</Text>
                </View>
              ) : (
                <Image
                  source={{ uri: p.uri }}
                  accessibilityLabel={`Page ${i + 1}`}
                  style={{
                    width: 104,
                    height: 138,
                    borderRadius: 8,
                    backgroundColor: colors.border,
                  }}
                />
              )}
              <Text style={styles.hint} numberOfLines={1}>
                Page {i + 1}
              </Text>
              <Button
                label="Remove"
                variant="ghost"
                disabled={busy}
                onPress={() => setPages((all) => all.filter((_, n) => n !== i))}
              />
            </View>
          ))}
        </View>
      ) : null}

      {canReceive && pages.length === 0 ? (
        <Button
          label="Quick Receive (no document)"
          variant="secondary"
          onPress={() => nav.push({ name: 'quickReceive' })}
        />
      ) : null}

      {inbox.error ? <Banner>{errorMessage(inbox.error)}</Banner> : null}
      {data && data.review.length > 0 ? <Text style={styles.h2}>Ready to review</Text> : null}
      {data?.review.map(row)}
      {data && data.processing.length > 0 ? <Text style={styles.h2}>Being read</Text> : null}
      {data?.processing.map(row)}
      {data && data.problem.length > 0 ? <Text style={styles.h2}>Need attention</Text> : null}
      {data?.problem.map(row)}
    </Screen>
  );
}
