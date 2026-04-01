import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      // nozk_ts uses NodeNext (requires .js specifiers in source), but Vite's
      // TS-aware resolver remaps .js → .ts when no compiled output exists.
      '@nozk': path.resolve(__dirname, '../nozk_ts'),
    },
    dedupe: ['mcl-wasm'],
  },
  optimizeDeps: {
    include: ['mcl-wasm'],
  },
})
