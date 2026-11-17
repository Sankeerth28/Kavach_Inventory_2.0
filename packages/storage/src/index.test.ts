import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LocalStorage, StorageObjectNotFound, createStorage, invoicePageKey } from './index';

describe('LocalStorage', () => {
  let dir: string;
  let storage: LocalStorage;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'kavach-storage-'));
    storage = new LocalStorage(dir);
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('stores, reads and deletes a document', async () => {
    const key = invoicePageKey('p1', 'i1', 1, 'image/jpeg');
    expect(key).toBe('projects/p1/invoices/i1/1.jpg');
    await storage.put(key, Buffer.from('hello'));
    expect((await storage.get(key)).toString()).toBe('hello');
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageObjectNotFound);
    // Deleting again is not an error.
    await storage.delete(key);
  });

  it('refuses keys that could leave the storage root', async () => {
    for (const key of ['../secret', 'a/../../b', '/etc/passwd', 'a\\b', 'a//b', '']) {
      await expect(storage.put(key, Buffer.from('x'))).rejects.toThrow('Invalid storage key');
      await expect(storage.get(key)).rejects.toThrow('Invalid storage key');
    }
  });

  it('names files by type', () => {
    expect(invoicePageKey('p', 'i', 2, 'application/pdf')).toMatch(/2\.pdf$/);
    expect(invoicePageKey('p', 'i', 3, 'image/png')).toMatch(/3\.png$/);
  });
});

describe('createStorage', () => {
  it('uses the local driver outside production and s3 in production', () => {
    expect(createStorage({ STORAGE_LOCAL_DIR: '.local/test-docs' }).driver).toBe('local');
    expect(
      createStorage({ NODE_ENV: 'production', S3_BUCKET: 'b', S3_REGION: 'ap-south-1' }).driver,
    ).toBe('s3');
  });

  it('fails clearly on a bad configuration', () => {
    expect(() => createStorage({ STORAGE_DRIVER: 's3' })).toThrow('S3_BUCKET');
    expect(() => createStorage({ STORAGE_DRIVER: 'ftp' })).toThrow('Unknown STORAGE_DRIVER');
  });
});
