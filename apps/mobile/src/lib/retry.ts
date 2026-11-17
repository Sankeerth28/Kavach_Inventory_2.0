import { ApiError } from '@kavach/api-client';
import * as SecureStore from 'expo-secure-store';

/**
 * Safe retries on a slow or dropping network (PRD §21.5, §13.3; ARCHITECTURE §8).
 *
 * Every posting carries an Idempotency-Key. The key is created BEFORE the first attempt and kept
 * on the device together with a fingerprint of what is being posted. If the request times out or
 * the app is closed, sending the same thing again reuses the same key, and the server returns the
 * original result instead of posting twice.
 *
 * The key is forgotten when the server gives a definite answer: success, or a refusal such as
 * "not enough stock". It is kept when the outcome is unknown: no connection, or a server error.
 *
 * A kept key is reused for 15 minutes only. After that the same payload is a new piece of work:
 * issuing 5 bags to the same place tomorrow must not be answered with yesterday's result.
 */
export const RETRY_WINDOW_MS = 15 * 60 * 1000;
const PREFIX = 'kavach.pending.';

/** A short stable fingerprint of the payload (FNV-1a). Not a security feature. */
export function signature(kind: string, payload: unknown): string {
  const text = `${kind}:${JSON.stringify(payload)}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return `${kind}.${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

export function newIdempotencyKey(): string {
  const random = () => Math.random().toString(36).slice(2, 12);
  return `m-${Date.now().toString(36)}-${random()}${random()}`;
}

const outcomeUnknown = (e: unknown): boolean =>
  !(e instanceof ApiError) || e.code === 'NETWORK' || e.status >= 500;

/**
 * Runs a posting with a key that survives retries of the same payload.
 * `post` receives the key and must send it as the Idempotency-Key.
 */
export async function postSafely<T>(
  kind: string,
  payload: unknown,
  post: (idempotencyKey: string) => Promise<T>,
): Promise<T> {
  const slot = PREFIX + signature(kind, payload);
  const kept = await SecureStore.getItemAsync(slot).catch(() => null);
  const [keptKey, keptAt] = (kept ?? '').split('|');
  let key = keptKey && Date.now() - Number(keptAt) < RETRY_WINDOW_MS ? keptKey : null;
  if (!key) {
    key = newIdempotencyKey();
    // Stored before the request leaves the device.
    await SecureStore.setItemAsync(slot, `${key}|${Date.now()}`).catch(() => undefined);
  }
  try {
    const result = await post(key);
    await SecureStore.deleteItemAsync(slot).catch(() => undefined);
    return result;
  } catch (e) {
    if (!outcomeUnknown(e)) await SecureStore.deleteItemAsync(slot).catch(() => undefined);
    throw e;
  }
}
