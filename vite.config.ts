import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
    host: true,
    watch: {
      ignored: ['**/public/models/**', '**/*.glb', '**/*.gltf', '**/*.bin']
    }
  },
  build: {
    target: 'esnext'
  }
});
