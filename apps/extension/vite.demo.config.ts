import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact({ devToolsEnabled: false })],
  server: { port: 5173, strictPort: true },
  define: { __LOOM_DEMO__: 'true' },
});
