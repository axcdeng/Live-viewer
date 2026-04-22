import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import saveRoutesPlugin from './vite-plugin-save-routes'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react(), saveRoutesPlugin()],
    server: {
        proxy: {
            '/__boxcast': {
                target: 'https://api.boxcast.com',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/__boxcast/, ''),
            },
        },
    },
})
