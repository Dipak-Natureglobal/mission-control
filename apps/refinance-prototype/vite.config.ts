import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import path from 'path'

// Mirrors protection-portal's vite.config.ts. The resolve.alias entries
// force a single copy of React, which prevents the "invalid hook call"
// error that shows up when sibling apps share node_modules at any point
// (esp. once protection-portal embeds refi-portal via file:../refi-portal
// per architecture/02-integration-boundaries.md).
//
// Port 5179 is the next free slot in the platform port map:
//   5173 — refi-prototype (legacy)
//   5174 — efs-prototype
//   5175 — protection-portal
//   5176 — insurance-portal
//   5177 — mission-control
//   5178 — customer-portal
//   5179 — refi-portal (this app)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 30005,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
})
