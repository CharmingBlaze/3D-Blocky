import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/@react-three/fiber')) return 'r3f'
          if (id.includes('node_modules/@react-three/drei')) return 'drei'
        },
      },
    },
  },
})
