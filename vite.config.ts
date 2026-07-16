import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    modulePreload: { polyfill: false },
    // Three.js is intentionally isolated as an ~801 kB minified / ~209 kB gzip
    // vendor chunk. Keep warnings actionable without splitting one runtime.
    chunkSizeWarningLimit: 850,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react-dom')) return 'react-dom'
          if (id.includes('node_modules/react/')) return 'react'
          if (id.includes('node_modules/zustand')) return 'zustand'
          if (id.includes('three/addons') || id.includes('three/examples')) return 'three-addons'
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/@react-three/fiber')) return 'r3f'
          if (id.includes('node_modules/@react-three/drei')) return 'drei'
        },
      },
    },
  },
})
