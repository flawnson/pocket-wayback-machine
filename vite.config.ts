import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { resolve } from "path"
import fs from "node:fs"

function copyManifestPlugin(): Plugin {
  return {
    name: "copy-extension-manifest",
    apply: "build",
    generateBundle() {
      const manifestPath = resolve(__dirname, "manifest.json")
      const outDir = resolve(__dirname, "dist")
      const raw = fs.readFileSync(manifestPath, "utf8")
      const manifest = JSON.parse(raw)

      // Make manifest point to files *inside dist*
      // Adjust if you use multiple HTML pages.
      manifest.background = { ...manifest.background, service_worker: "sw.js", type: "module" }
      manifest.action = { ...manifest.action, default_popup: "index.html" }

      fs.mkdirSync(outDir, { recursive: true })
      fs.writeFileSync(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), copyManifestPlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: resolve(__dirname, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // UI pages
        popup: resolve(__dirname, "index.html"),

        // Extension scripts (these will compile from TS to JS and be emitted)
        sw: resolve(__dirname, "sw.ts"),
        content: resolve(__dirname, "content.ts"),

        // If you have a non-React archive page script:
        archive: resolve(__dirname, "archive.ts"),
      },
      output: {
        // Ensure stable names so manifest can reference sw.js/content.js directly
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
})