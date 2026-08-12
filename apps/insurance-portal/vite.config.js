import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Mirrors protection-portal's vite.config.js. The resolve.alias entries
// force a single copy of React, which prevents the "invalid hook call"
// error that shows up when sibling apps share node_modules at any point.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 30002,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      react: path.resolve(__dirname, 'node_modules/react'),
      'react-dom': path.resolve(__dirname, 'node_modules/react-dom'),
    },
  },
})
