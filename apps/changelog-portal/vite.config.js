import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 30007 is this app's slot in the Blinker platform port map (30001-30007).
// Unlike its siblings this app has no upstream repo, no dev proxies and no
// cross-portal imports — it only reads the generated JSON in src/data/.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 30007,
    strictPort: true,
  },
})
