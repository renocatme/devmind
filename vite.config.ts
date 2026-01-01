import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  
  return {
    server: {
      port: 12000,
      host: '0.0.0.0',
      allowedHosts: true,
      cors: true,
      headers: {
        'X-Frame-Options': 'ALLOWALL',
        // Required for WebContainer API
        'Cross-Origin-Embedder-Policy': 'credentialless',
        'Cross-Origin-Opener-Policy': 'same-origin',
      },
    },
    plugins: [react()],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@sdk': path.resolve(__dirname, 'sdk'),
        '@knowledge': path.resolve(__dirname, 'knowledge'),
        '@runtime': path.resolve(__dirname, 'runtime'),
      }
    },
    optimizeDeps: {
      exclude: ['@webcontainer/api'],
    },
  };
});
