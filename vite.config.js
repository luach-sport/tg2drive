import { defineConfig } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// GramJS (the Telegram library) expects some Node built-ins; the polyfills make it run in the browser.
export default defineConfig({
  base: './',
  plugins: [nodePolyfills({ exclude: ['vm', 'fs'], globals: { Buffer: true, global: true, process: true } })],
  build: { target: 'es2020', chunkSizeWarningLimit: 3000 },
});
