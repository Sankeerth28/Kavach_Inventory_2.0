import { ApiError } from '@kavach/api-client';
import { IdempotencyKeySchema } from '@kavach/shared';
import { beforeEach, expect, it, jest } from '@jest/globals';
import { RETRY_WINDOW_MS, newIdempotencyKey, postSafely, signature } from './retry';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));

const payload = { storeId: 's1', lines: [{ materialId: 'm1', quantity: '5' }] };
const network = () => new ApiError(0, 'NETWORK', 'Cannot reach the server.');

beforeEach(() => {
  mockStore.clear();
});

it('makes keys the API accepts', () => {
  for (let i = 0; i < 200; i += 1)
    expect(IdempotencyKeySchema.safeParse(newIdempotencyKey()).success).toBe(true);
});

it('stores slots under names the device keystore accepts', () => {
  expect(`kavach.pending.${signature('invoice-confirm', payload)}`).toMatch(/^[A-Za-z0-9._-]+$/);
});

it('sends the same key again when the outcome of the first attempt is unknown', async () => {
  const keys: string[] = [];
  await expect(
    postSafely('issue', payload, async (key) => {
      keys.push(key);
      throw network();
    }),
  ).rejects.toThrow();
  const result = await postSafely('issue', payload, async (key) => {
    keys.push(key);
    return 'posted';
  });

  expect(result).toBe('posted');
  expect(keys[0]).toBe(keys[1]);
  expect(mockStore.size).toBe(0);
});

it('keeps the key after a server error', async () => {
  const keys: string[] = [];
  const attempt = (fail: boolean) =>
    postSafely('issue', payload, async (key) => {
      keys.push(key);
      if (fail) throw new ApiError(500, 'INTERNAL', 'Something went wrong.');
      return 'ok';
    });
  await expect(attempt(true)).rejects.toThrow();
  await attempt(false);

  expect(keys[0]).toBe(keys[1]);
});

it('forgets the key when the server refuses the posting', async () => {
  const keys: string[] = [];
  await expect(
    postSafely('issue', payload, async (key) => {
      keys.push(key);
      throw new ApiError(409, 'INSUFFICIENT_STOCK', 'Not enough stock.');
    }),
  ).rejects.toThrow();
  await postSafely('issue', payload, async (key) => {
    keys.push(key);
    return 'ok';
  });

  expect(keys[0]).not.toBe(keys[1]);
});

it('uses a new key for a different payload or a different kind of posting', async () => {
  const keys: string[] = [];
  const fail = async (key: string) => {
    keys.push(key);
    throw network();
  };
  await expect(postSafely('issue', payload, fail)).rejects.toThrow();
  await expect(postSafely('issue', { ...payload, storeId: 's2' }, fail)).rejects.toThrow();
  await expect(postSafely('return', payload, fail)).rejects.toThrow();

  expect(new Set(keys).size).toBe(3);
});

it('does not reuse a kept key after the retry window', async () => {
  const keys: string[] = [];
  const now = jest.spyOn(Date, 'now');
  now.mockReturnValue(1_000_000);
  await expect(
    postSafely('issue', payload, async (key) => {
      keys.push(key);
      throw network();
    }),
  ).rejects.toThrow();
  now.mockReturnValue(1_000_000 + RETRY_WINDOW_MS + 1);
  await postSafely('issue', payload, async (key) => {
    keys.push(key);
    return 'ok';
  });
  now.mockRestore();

  expect(keys[0]).not.toBe(keys[1]);
});
