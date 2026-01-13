import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/fit-pace-adjuster/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html')
      }
    },
    outDir: 'dist',
    assetsDir: 'assets'
  }
})