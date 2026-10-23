import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3001,
    open: false,
    host: true
  },
  build: {
    target: 'esnext'
  }
});
