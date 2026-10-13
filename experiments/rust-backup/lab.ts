import { importCookies, type ImportOptions } from '../../packages/core/src';
import { createRustImporter } from './adapter';

let worker: Worker | undefined;
let sequence = 0;
window.loomLab = {
  reference: (text: string, options: ImportOptions) => importCookies(text, options),
  createRustImporter,
  reset() {
    worker?.terminate();
    worker = undefined;
  },
  async run(engine: 'main' | 'worker' | 'rust', text: string, options: ImportOptions) {
    if (engine === 'main') {
      const started = performance.now();
      const result = importCookies(text, options);
      return { result, computeMs: performance.now() - started, initMs: 0, wasmMemoryBytes: 0 };
    }
    worker ??= new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      const done = (event: MessageEvent) => {
        if (event.data.id !== id) return;
        worker!.removeEventListener('message', done);
        if (event.data.error) reject(new Error(event.data.error));
        else resolve(event.data);
      };
      worker!.addEventListener('message', done);
      worker!.postMessage({ id, engine, text, options });
    });
  },
};

declare global {
  interface Window {
    loomLab: any;
  }
}
