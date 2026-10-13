import { build } from 'vite';
import { mkdir, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve('experiments/rust-backup');
const profile = process.argv[2] ?? 'release';
if (!['release', 'speed', 'small'].includes(profile))
  throw new Error('Unknown Rust build profile.');
// This lab stays outside production entrypoints. Rust is not a normal build dependency.
const toolchain = process.env.RUST_LAB_TOOLCHAIN ?? 'stable';
if (!['stable', '1.98.0'].includes(toolchain))
  throw new Error('Use Rust 1.98.0 for this experiment.');
const version = execFileSync('rustc', [`+${toolchain}`, '--version'], { encoding: 'utf8' });
if (!version.startsWith('rustc 1.98.0 ')) throw new Error('The experiment requires Rust 1.98.0.');
execFileSync(
  'cargo',
  [
    `+${toolchain}`,
    'build',
    '--locked',
    '--manifest-path',
    `${root}/Cargo.toml`,
    '--profile',
    profile,
    '--target',
    'wasm32-unknown-unknown',
  ],
  { stdio: 'inherit' },
);
await mkdir(`${root}/dist`, { recursive: true });
await build({
  configFile: false,
  root,
  build: {
    emptyOutDir: true,
    outDir: 'dist',
    rolldownOptions: {
      input: { lab: `${root}/lab.ts`, worker: `${root}/worker.ts` },
      output: { entryFileNames: '[name].js', chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});
await copyFile(
  `${root}/target/wasm32-unknown-unknown/${profile}/cookie_loom_backup_scan.wasm`,
  `${root}/dist/scanner.wasm`,
);
await copyFile(`${root}/index.html`, `${root}/dist/index.html`);
console.log(`Built isolated ${profile} Rust/TypeScript browser lab.`);
