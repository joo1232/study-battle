import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // GitHub Pages serves this project from /study-battle/.
  base: '/study-battle/',
  plugins: [react()],
})
