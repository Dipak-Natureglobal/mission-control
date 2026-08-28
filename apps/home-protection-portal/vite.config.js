import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Mirrors protection-portal's vite.config.js. The resolve.alias entries force
// a single copy of React, which prevents the "invalid hook call" error that
// shows up when sibling apps share node_modules at any point.
//
// The `/se-rating` proxy matters here for the SAME reason it does in
// protection-portal: `packages/integrations/product_admin/stoneeagle.js`
// issues a RELATIVE fetch to `/se-rating` when the DevPanel flips the
// provider mode to 'proxy'. A packages-level relative fetch resolves
// against whichever dev server is hosting the page, so every host app that
// can reach that code path needs its own copy of the proxy (see the
// embed-gotchas memory: mission-control needed one too).

export default defineConfig({
  plugins: [react()],
  server: {
    // 5178 — the 5173-5177 slots are taken (refi 5173, efs 5174,
    // protection 5175, insurance 5176, mission-control 5177).
    port: 30006,
    proxy: {
      '/efs-charge': {
        target: 'http://localhost:8080',
        changeOrigin: true,
        secure: false,
      },
      '/se-rating': {
        target: 'https://staging.fiadmin.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/se-rating/, '/scs.webservice'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            // SCS may reject requests carrying the dev-server Origin header.
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
