import { defineConfig } from 'wxt';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifestVersion: 3,
  zip: {
    name: 'cookie-loom',
    // Mozilla must be able to rebuild the extension with its workspace dependency.
    sourcesRoot: fileURLToPath(new URL('../..', import.meta.url)),
    dotSources: true,
    includeSources: [
      'package.json',
      'package-lock.json',
      '.nvmrc',
      '.editorconfig',
      '.prettierrc.json',
      '.prettierignore',
      'apps/extension/**',
      'packages/core/**',
      'scripts/**',
      'licenses/**',
      'docs/**',
      '*.md',
      'LICENSE',
      'NOTICE',
    ],
    excludeSources: ['**/.output/**', '**/.wxt/**', '**/.env', '**/.env.*', '**/*.log'],
  },
  hooks: {
    'vite:build:extendConfig'(entrypoints, config) {
      if (!entrypoints.every((entry) => entry.inputPath.endsWith('.html'))) return;
      config.build ??= {};
      config.build.rollupOptions ??= {};
      const output = config.build.rollupOptions.output;
      if (Array.isArray(output)) throw new Error('Expected one browser-page output.');
      config.build.rollupOptions.output = {
        ...output,
        manualChunks(id) {
          if (id.includes('/node_modules/react')) return 'react-vendor';
        },
      };
    },
  },
  manifest: ({ browser }) => ({
    name: 'Cookie Loom',
    description:
      'Your cookies, untangled. A private cookie workbench with safe cleanup and portable backups.',
    version: '0.1.0',
    homepage_url: 'https://github.com/q1/cookie-quick-manager',
    permissions: [
      'cookies',
      'storage',
      'activeTab',
      ...(browser === 'firefox' ? ['contextualIdentities'] : []),
    ],
    optional_permissions: ['scripting'],
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      96: 'icons/96.png',
      128: 'icons/128.png',
    },
    action: { default_title: 'Cookie Loom' },
    ...(browser === 'chrome'
      ? { minimum_chrome_version: '132' }
      : {
          browser_specific_settings: {
            gecko_android: { strict_min_version: '142.0' },
            gecko: {
              id: 'cookie-loom@q1.github.io',
              strict_min_version: '140.0',
              data_collection_permissions: { required: ['none'] },
            },
          },
        }),
  }),
});
