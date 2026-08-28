import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Mission Control runs on port 5177 to coexist with the other Blinker prototypes:
//   refi (5173), efs (5174), protection-portal (5175), insurance-portal (5176)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 30003,
    strictPort: true,
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
      // These two aliases force every `file:` portal dependency (protection,
      // refi, insurance, and — Wave 39 / ADR 30 — home-protection-portal) to
      // resolve react/react-dom against MISSION-CONTROL's own copy rather
      // than whatever copy sits in the portal's own node_modules. Without
      // this, two React instances mount in the same tree and hooks break
      // with "Invalid hook call". Applies package-wide, so a newly added
      // portal dep needs no alias entry of its own.
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
})
