function assertUnicode(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new Error('The value contains invalid Unicode.');
      index++;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error('The value contains invalid Unicode.');
    }
  }
}

/** Encode the complete value as one URL component; this does not build a URL. */
export function encodeUrlValue(value: string): string {
  assertUnicode(value);
  return encodeURIComponent(value);
}

/** Decode percent escapes. A literal + remains +, as it is not a form submission. */
export function decodeUrlValue(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    assertUnicode(decoded);
    return decoded;
  } catch {
    throw new Error('The value is not valid percent-encoded UTF-8.');
  }
}

/** Standard Base64 of UTF-8 bytes, rather than btoa's Latin-1 interpretation. */
export function encodeBase64Value(value: string): string {
  assertUnicode(value);
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

/** Accept standard padded/unpadded Base64 and ASCII whitespace; reject non-UTF-8 bytes. */
export function decodeBase64Value(value: string): string {
  const compact = value.replace(/[\t\n\f\r ]/g, '');
  if (
    !/^[A-Za-z0-9+/]*={0,2}$/.test(compact) ||
    compact.length % 4 === 1 ||
    (compact.includes('=') && compact.length % 4 !== 0)
  ) {
    throw new Error('The value is not valid standard Base64.');
  }
  try {
    const binary = atob(compact);
    // Reject noncanonical unused tail bits that permissive atob implementations ignore.
    if (btoa(binary).replace(/=+$/, '') !== compact.replace(/=+$/, '')) {
      throw new Error('Noncanonical Base64.');
    }
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    // Preserve an encoded BOM as actual value data instead of silently consuming it.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error('The value must be valid standard Base64 containing UTF-8 text.');
  }
}
