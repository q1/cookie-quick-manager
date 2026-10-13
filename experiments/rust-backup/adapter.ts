import {
  cookieKey,
  importCookies,
  LIMITS,
  validateCookie,
  type CookieRecord,
  type ImportOptions,
  type ImportResult,
} from '../../packages/core/src';

interface Exports {
  memory: WebAssembly.Memory;
  input_buffer: (length: number) => number;
  scan_input: () => number;
  output_length: () => number;
  release_buffers: () => void;
}

export async function createRustImporter(url: string) {
  const { instance } = await WebAssembly.instantiateStreaming(fetch(url), {});
  const wasm = instance.exports as unknown as Exports;
  const encoder = new TextEncoder();
  return {
    memoryBytes: () => wasm.memory.buffer.byteLength,
    release: () => wasm.release_buffers(),
    import(text: string, options: ImportOptions): ImportResult {
      const content = text.replace(/^\uFEFF/, '');
      const trimmed = content.trim();
      // Rust only accelerates Netscape delimiter scanning. Other formats and
      // unpaired UTF-16 inputs retain the reference implementation verbatim.
      if (
        /^[\[{]/.test(trimmed) ||
        !trimmed ||
        !text.isWellFormed() ||
        typeof options.storeId !== 'string' ||
        !options.storeId ||
        /[\x00-\x1f\x7f]/.test(options.storeId) ||
        (options.now !== undefined && (!Number.isFinite(options.now) || options.now < 0)) ||
        (options.netscapeMode !== undefined &&
          !['standard', 'legacy-cqm'].includes(options.netscapeMode))
      )
        return importCookies(text, options);
      const bytes = encoder.encode(content);
      if (
        text.length > LIMITS.importBytes ||
        bytes.length + (text.startsWith('\uFEFF') ? 3 : 0) > LIMITS.importBytes
      )
        return importCookies(text, options);
      const pointer = wasm.input_buffer(bytes.length);
      new Uint8Array(wasm.memory.buffer, pointer, bytes.length).set(bytes);
      const offset = wasm.scan_input();
      const rows = new Uint32Array(wasm.memory.buffer, offset, wasm.output_length());
      if (rows[1] === 2) throw new Error('Rust scanner received invalid UTF-8.');
      const warnings = new Set([
        'Netscape format cannot preserve SameSite, cookie stores, first-party isolation, or partition keys. Use Cookie Loom JSON for a full-fidelity backup.',
        `Netscape cookies use the selected store (${options.storeId}) and SameSite=unspecified.`,
      ]);
      if (options.netscapeMode === 'legacy-cqm')
        warnings.add(
          'Legacy Cookie Quick Manager mode is enabled: cookie scope is inferred from domain dots instead of the include-subdomains column.',
        );
      const result: ImportResult = { format: 'netscape', cookies: [], errors: [], warnings: [] };
      const keys = new Set<string>();
      const boolean = (value: string, name: string) => {
        if (value === 'true' || value === 'TRUE') return true;
        if (value === 'false' || value === 'FALSE') return false;
        throw new Error(`${name} must be true or false.`);
      };
      for (let index = 0; index < Math.min(rows[0]!, LIMITS.cookies); index++) {
        const start = 2 + index * 17;
        const line = rows[start]!;
        try {
          if (rows[start + 2] !== 7)
            throw new Error('Expected exactly seven tab-separated Netscape fields.');
          const field = (i: number) =>
            content.slice(rows[start + 3 + i * 2], rows[start + 4 + i * 2]);
          const domain = field(0);
          const flag = boolean(field(1), 'Include subdomains');
          const dotted = domain.startsWith('.');
          const hostOnly = !(options.netscapeMode === 'legacy-cqm' ? dotted : flag);
          const expiryText = field(4);
          if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(expiryText))
            throw new Error('Expiration must be a Unix timestamp, or 0 for a session cookie.');
          const expiry = Number(expiryText);
          if (!Number.isFinite(expiry) || expiry < 0)
            throw new Error('Invalid expiration timestamp.');
          const cookie: CookieRecord = {
            domain: `${hostOnly ? '' : '.'}${dotted ? domain.slice(1) : domain}`,
            path: field(2),
            secure: boolean(field(3), 'Secure'),
            name: field(5),
            value: field(6),
            httpOnly: rows[start + 1] === 1,
            hostOnly,
            session: expiry === 0,
            sameSite: 'unspecified',
            storeId: options.storeId,
            ...(expiry ? { expirationDate: expiry } : {}),
          };
          const issues = validateCookie(cookie, { now: options.now });
          const errors = issues.filter((issue) => issue.severity === 'error');
          if (errors.length) throw new Error(errors.map((issue) => issue.message).join(' '));
          const key = cookieKey(cookie);
          if (keys.has(key))
            throw new Error(
              'Duplicate cookie identity; each store, partition, domain, path, and name must be unique.',
            );
          keys.add(key);
          for (const issue of issues) warnings.add(issue.message);
          result.cookies.push(cookie);
        } catch (error) {
          result.errors.push({
            line,
            message: error instanceof Error ? error.message : 'Invalid Netscape row.',
          });
        }
      }
      if (rows[1] === 1) {
        result.cookies = [];
        result.errors.push({ message: `Import contains more than ${LIMITS.cookies} cookie rows.` });
      }
      if (!rows[0]) result.errors.push({ message: 'No cookie rows found in the Netscape file.' });
      result.warnings = [...warnings];
      return result;
    },
  };
}
