import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/web-ext/bin/web-ext.js'),
    'lint',
    '--source-dir',
    resolve(root, 'apps/extension/.output/firefox-mv3'),
    '--output=json',
  ],
  { encoding: 'utf8' },
);
if (result.error) throw result.error;
let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  throw new Error(`Firefox linter did not return JSON: ${result.stderr}`);
}

// React DOM contains two internal innerHTML assignments, including its implementation
// of dangerouslySetInnerHTML. Application data always uses React text nodes. Keep
// framework code in a dedicated chunk, prohibit these sinks in our source, and
// reject every other linter warning. A React update that changes the count needs review.
function verifyTextOnlySource(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) verifyTextOnlySource(path);
    else if (/\.[jt]sx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      if (
        /dangerouslySetInnerHTML|\.innerHTML\s*=|insertAdjacentHTML/.test(
          readFileSync(path, 'utf8'),
        )
      ) {
        throw new Error(`Unreviewed HTML injection sink in ${path}`);
      }
    }
  }
}
verifyTextOnlySource(resolve(root, 'apps/extension/src'));
const frameworkWarnings = report.warnings.filter(
  (warning) =>
    warning.code === 'UNSAFE_VAR_ASSIGNMENT' &&
    /^chunks\/react-vendor-[\w-]+\.js$/.test(warning.file),
);
const unexpected = report.warnings.filter((warning) => !frameworkWarnings.includes(warning));
if (report.errors.length || unexpected.length || frameworkWarnings.length > 2) {
  console.error(
    JSON.stringify({ errors: report.errors, warnings: unexpected, frameworkWarnings }, null, 2),
  );
  process.exit(1);
}
console.log(
  `Firefox validation passed: ${report.errors.length} errors, ${unexpected.length} unexpected warnings.`,
);
console.log(
  `${frameworkWarnings.length} reviewed React DOM innerHTML warnings in the isolated vendor chunk.`,
);
