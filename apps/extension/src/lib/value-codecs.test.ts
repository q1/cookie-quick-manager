import { describe, expect, it } from 'vitest';
import {
  decodeBase64Value,
  decodeUrlValue,
  encodeBase64Value,
  encodeUrlValue,
} from './value-codecs';

describe('URL value tools', () => {
  it('encodes and decodes Unicode as a complete component', () => {
    const value = 'café / 🍪?mode=dark&value=a+b';
    const encoded = encodeUrlValue(value);
    expect(encoded).toBe('caf%C3%A9%20%2F%20%F0%9F%8D%AA%3Fmode%3Ddark%26value%3Da%2Bb');
    expect(decodeUrlValue(encoded)).toBe(value);
    expect(decodeUrlValue('a+b')).toBe('a+b');
  });

  it.each(['%', '%2', '%GG', '%C0%AF', '%ED%A0%80', '%FF', '\ud800'])(
    'rejects malformed input without exposing it',
    (value) => {
      expect(() => decodeUrlValue(value)).toThrow('The value is not valid percent-encoded UTF-8.');
    },
  );

  it('rejects lone surrogates before encoding instead of changing their content', () => {
    expect(() => encodeUrlValue('\ud800')).toThrow('invalid Unicode');
    expect(() => encodeUrlValue('\udc00')).toThrow('invalid Unicode');
  });
});

describe('UTF-8 Base64 value tools', () => {
  it.each(['', 'hello', 'café 🍪', '你好', '\uFEFFcookie', 'one\nline\u0000'])(
    'round-trips %j',
    (value) => {
      expect(decodeBase64Value(encodeBase64Value(value))).toBe(value);
    },
  );

  it('uses UTF-8 bytes and accepts conventional line wrapping and omitted padding', () => {
    expect(encodeBase64Value('café')).toBe('Y2Fmw6k=');
    expect(decodeBase64Value('Y2Fm\nw6k=\r\n')).toBe('café');
    expect(decodeBase64Value('Y2Fmw6k')).toBe('café');
  });

  it.each([
    'a',
    'a===',
    '=YQ=',
    'YQ=',
    'YQ====',
    'YWJj-',
    'YWJj_',
    'YWJj!',
    'Zh==',
    '/w==',
    'wK8=',
  ])('rejects malformed Base64 or non-UTF-8 bytes: %s', (value) => {
    expect(() => decodeBase64Value(value)).toThrow(/valid standard Base64/);
  });

  it('rejects invalid Unicode rather than replacing it with U+FFFD', () => {
    expect(() => encodeBase64Value('\ud800')).toThrow('invalid Unicode');
    expect(() => encodeBase64Value('\udc00')).toThrow('invalid Unicode');
  });

  it('handles a full-size cookie value without overflowing argument limits', () => {
    const value = '🍪'.repeat(32_768);
    expect(decodeBase64Value(encodeBase64Value(value))).toBe(value);
  });
});
