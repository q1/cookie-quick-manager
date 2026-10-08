import { useState } from 'react';
import {
  decodeBase64Value,
  decodeUrlValue,
  encodeBase64Value,
  encodeUrlValue,
} from '../lib/value-codecs';
import { ErrorNotice } from './shared';

export function ValueTools({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const [error, setError] = useState('');

  function transform(codec: (input: string) => string) {
    try {
      const transformed = codec(value);
      setError('');
      onChange(transformed);
    } catch {
      setError('The value could not be converted. Check its encoding and try again.');
    }
  }

  return (
    <details className="advanced value-tools">
      <summary>Value tools</summary>
      <p className="small muted">Replaces the draft value. Save to apply.</p>
      <div className="value-tool-actions">
        <button className="button" type="button" onClick={() => transform(encodeUrlValue)}>
          URL encode
        </button>
        <button className="button" type="button" onClick={() => transform(decodeUrlValue)}>
          URL decode
        </button>
      </div>
      <div className="value-tool-actions">
        <button className="button" type="button" onClick={() => transform(encodeBase64Value)}>
          Base64 encode
        </button>
        <button className="button" type="button" onClick={() => transform(decodeBase64Value)}>
          Base64 decode
        </button>
      </div>

      {error ? <ErrorNotice>{error}</ErrorNotice> : null}
    </details>
  );
}
