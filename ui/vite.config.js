import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vite.dev/config/
export default defineConfig({
    base: './',
    plugins: [
        react(),
        tailwindcss()
    ],
    build: {
        outDir: resolve(__dirname, "..", "dist"),
        emptyOutDir: true,
        rollupOptions: {
            input: {
                popup: resolve(__dirname, "index.html"),
            },
        },
    },
})
