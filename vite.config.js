import { defineConfig } from 'vite';

export default defineConfig({
  root: './',
  publicDir: 'assets',
  server: {
    port: 3000,
    open: true,
    host: true // Allow network access for mobile testing
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three']
        }
      }
    }
  },
  optimizeDeps: {
    include: ['three']
  }
});
