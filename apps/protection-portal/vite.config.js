import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Mirrors the refi prototype's vite.config.js. The resolve.alias entries
// force a single copy of React, which prevents the "invalid hook call"
// error that shows up when sibling apps share node_modules at any point.

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5175,
    proxy: {
      '/efs-charge': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
        // Phase 1: cloud-function endpoint may not be running locally — the
        // packages-level chargeOneTimeToken returns a synthetic-success
        // result in 'fixture' mode, so the proxy only matters when the
        // DevPanel toggle flips to 'proxy' AND emulate='auto'. The target
        // is wired to the payment-processing-platform cloud-function dev
        // port (default 8080) per packages/integrations/payment/_TODO.md.
      },
      '/se-rating': {
        target: 'https://staging.fiadmin.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/se-rating/, '/scs.webservice'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // SCS may reject requests carrying the dev-server Origin header.
            // Strip it so the upstream sees the request as same-origin to itself.
            proxyReq.removeHeader('origin');
            proxyReq.removeHeader('referer');
          });
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
})
