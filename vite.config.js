import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import saveRoutesPlugin from './vite-plugin-save-routes'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), saveRoutesPlugin()],
})
