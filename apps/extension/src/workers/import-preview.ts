import { importCookies } from '@cookie-loom/core';

self.onmessage = async (event) => {
  try {
    const { input, options } = event.data;
    const text = typeof input === 'string' ? input : await (input as Blob).text();
    self.postMessage({ result: importCookies(text, options) });
  } catch {
    // Transport/reader failures never expose file contents in an error message.
    self.postMessage({ error: true });
  }
};
