import { importCookies, type ImportOptions, type ImportResult } from '@cookie-loom/core';

type WorkerPort = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>;
const INLINE_LIMIT = 256 * 1024;

/** Every large preview has a disposable worker; closing the dialog frees its data. */
export function previewImport(
  input: string | Blob,
  options: ImportOptions,
  signal: AbortSignal,
  createWorker: () => WorkerPort = () =>
    new Worker(new URL('../workers/import-preview.ts', import.meta.url), { type: 'module' }),
): Promise<ImportResult> {
  if (signal.aborted) return Promise.reject(new DOMException('Preview canceled.', 'AbortError'));
  if (typeof input === 'string' && input.length < INLINE_LIMIT)
    return Promise.resolve(importCookies(input, options));
  return new Promise((resolve, reject) => {
    let worker: WorkerPort | undefined;
    const cleanup = () => {
      signal.removeEventListener('abort', cancel);
      if (!worker) return;
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException('Preview canceled.', 'AbortError'));
    };
    try {
      worker = createWorker();
      worker.onmessage = (event) => {
        cleanup();
        if (event.data.error)
          reject(new Error('Unable to process this backup. Try reviewing it again.'));
        else resolve(event.data.result);
      };
      worker.onerror = (event) => {
        event.preventDefault();
        cleanup();
        reject(new Error('Unable to process this backup. Try reviewing it again.'));
      };
      signal.addEventListener('abort', cancel, { once: true });
      worker.postMessage({ input, options });
    } catch {
      cleanup();
      reject(new Error('Unable to start the backup preview. Try again.'));
    }
  });
}
