import { importCookies } from '../../packages/core/src';
import { createRustImporter } from './adapter';

let rust: Awaited<ReturnType<typeof createRustImporter>> | undefined;
self.onmessage = async (event) => {
  const { id, engine, text, options } = event.data;
  try {
    const started = performance.now();
    const useRust = engine === 'rust' && !/^[\[{]/.test(text.trim());
    if (useRust)
      rust ??= await createRustImporter(new URL('/scanner.wasm', self.location.href).href);
    const ready = performance.now();
    const result = useRust ? rust!.import(text, options) : importCookies(text, options);
    const finished = performance.now();
    self.postMessage({
      id,
      result,
      computeMs: finished - ready,
      initMs: ready - started,
      wasmMemoryBytes: rust?.memoryBytes() ?? 0,
    });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : 'Worker failed.' });
  }
};
