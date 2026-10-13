import { describe, expect, it, vi } from 'bun:test';
import { importCookies } from '@cookie-loom/core';
import { previewImport } from './import-preview';

function fixture() {
  const worker = {
    onmessage: null as Worker['onmessage'],
    onerror: null as Worker['onerror'],
    postMessage: vi.fn(),
    terminate: vi.fn(),
  };
  return { worker, create: vi.fn(() => worker), controller: new AbortController() };
}

describe('import preview lifecycle', () => {
  it('keeps small pasted backups inline without starting a worker', async () => {
    const f = fixture();
    const text = 'example.test\tFALSE\t/\tTRUE\t0\tname\tvalue';
    const options = { storeId: '0' };
    expect(await previewImport(text, options, f.controller.signal, f.create)).toEqual(
      importCookies(text, options),
    );
    expect(f.create).not.toHaveBeenCalled();
  });
  it('transfers a file handle, returns the complete preview, and terminates its worker', async () => {
    const f = fixture();
    const blob = new Blob(['# synthetic']);
    const pending = previewImport(blob, { storeId: '0' }, f.controller.signal, f.create);
    expect(f.worker.postMessage).toHaveBeenCalledWith({ input: blob, options: { storeId: '0' } });
    const result = importCookies('# synthetic', { storeId: '0' });
    f.worker.onmessage!.call(
      f.worker as unknown as Worker,
      new MessageEvent('message', { data: { result } }),
    );
    expect(await pending).toEqual(result);
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    expect(f.worker.onmessage).toBeNull();
    f.controller.abort();
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('cancels pending work and cannot accept a stale response after closing', async () => {
    const f = fixture();
    const pending = previewImport(
      'x'.repeat(256 * 1024),
      { storeId: '0' },
      f.controller.signal,
      f.create,
    );
    f.controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
    expect(f.worker.onmessage).toBeNull();
  });
  it('reports a fixed transport error and releases the worker', async () => {
    const f = fixture();
    const pending = previewImport(new Blob(), { storeId: '0' }, f.controller.signal, f.create);
    f.worker.onmessage!.call(
      f.worker as unknown as Worker,
      new MessageEvent('message', { data: { error: 'secret-file-content' } }),
    );
    await expect(pending).rejects.toThrow('Unable to process this backup.');
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('handles a startup failure and an already canceled request', async () => {
    const f = fixture();
    const fail = () => {
      throw new Error('private-file-value');
    };
    await expect(
      previewImport(new Blob(), { storeId: '0' }, f.controller.signal, fail),
    ).rejects.toThrow('Unable to start the backup preview.');
    f.controller.abort();
    await expect(
      previewImport(new Blob(), { storeId: '0' }, f.controller.signal, f.create),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.create).not.toHaveBeenCalled();
  });

  it('handles a worker script failure without exposing its underlying message', async () => {
    const f = fixture();
    const pending = previewImport(new Blob(), { storeId: '0' }, f.controller.signal, f.create);
    const event = new Event('error', { cancelable: true }) as ErrorEvent;
    f.worker.onerror!.call(f.worker as unknown as Worker, event);
    await expect(pending).rejects.toThrow('Unable to process this backup.');
    expect(event.defaultPrevented).toBe(true);
    expect(f.worker.terminate).toHaveBeenCalledTimes(1);
  });
});
