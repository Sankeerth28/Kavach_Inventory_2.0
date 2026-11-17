import { describe, expect, it } from 'vitest';
import { processPing } from './ping.processor';

describe('processPing', () => {
  it('echoes the message and reports the worker as healthy', async () => {
    await expect(processPing({ data: { message: 'hello' } })).resolves.toEqual({
      status: 'ok',
      service: 'worker',
      echo: 'hello',
    });
  });

  it('rejects an invalid payload', async () => {
    await expect(processPing({ data: { message: 42 } })).rejects.toThrow();
  });
});
