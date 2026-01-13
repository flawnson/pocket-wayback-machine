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
    writeBundle() {
      // Remove crossorigin attribute from CSS links in HTML files
      // This can cause issues in Chrome extension popups
      const htmlFiles = ["index.html", "archive.html"]
      const outDir = resolve(__dirname, "dist")
      
      for (const htmlFile of htmlFiles) {
        const htmlPath = resolve(outDir, htmlFile)
        if (fs.existsSync(htmlPath)) {
          let html = fs.readFileSync(htmlPath, "utf8")
          // Remove crossorigin from stylesheet links
          html = html.replace(/<link([^>]*)\s+crossorigin([^>]*rel=["']stylesheet["'][^>]*)>/gi, '<link$1$3>')
          html = html.replace(/<link([^>]*rel=["']stylesheet["'][^>]*)\s+crossorigin([^>]*)>/gi, '<link$1$2>')
          
          // For index.html (popup), ensure CSS link comes before script tag
          // This is critical for Chrome extension popups
          if (htmlFile === "index.html") {
            // Extract the stylesheet link
            const stylesheetMatch = html.match(/<link[^>]*rel=["']stylesheet["'][^>]*>/i)
            if (stylesheetMatch) {
              const stylesheetLink = stylesheetMatch[0]
              // Remove it from current position
              html = html.replace(/<link[^>]*rel=["']stylesheet["'][^>]*>\s*/i, "")
              // Find the position after viewport meta tag or title
              const insertAfter = html.match(/<meta[^>]*name=["']viewport["'][^>]*>/i) 
                || html.match(/<title>.*?<\/title>/i)
              if (insertAfter) {
                const insertPos = html.indexOf(insertAfter[0]) + insertAfter[0].length
                html = html.slice(0, insertPos) + "\n    " + stylesheetLink + html.slice(insertPos)
              } else {
                // Fallback: insert after charset meta
                const charsetMatch = html.match(/<meta[^>]*charset[^>]*>/i)
                if (charsetMatch) {
                  const insertPos = html.indexOf(charsetMatch[0]) + charsetMatch[0].length
                  html = html.slice(0, insertPos) + "\n    " + stylesheetLink + html.slice(insertPos)
                }
              }
            }
          }
          
          fs.writeFileSync(htmlPath, html)
        }
      }
      
      // Create/update archive.html (for JS entry point)
      // This allows src/archive/main.tsx to be the source entry
      const archiveHtmlPath = resolve(outDir, "archive.html")
      // Find the CSS file that was generated
      const assetsDir = resolve(outDir, "assets")
      let cssFile = null
      if (fs.existsSync(assetsDir)) {
        const assets = fs.readdirSync(assetsDir)
        cssFile = assets.find(f => f.endsWith(".css"))
      }
      
      // Find chunk files that might need modulepreload
      const chunksDir = resolve(outDir, "chunks")
      const chunkFiles = fs.existsSync(chunksDir) 
        ? fs.readdirSync(chunksDir).filter(f => f.endsWith(".js"))
        : []
      
      // Build modulepreload links (similar to index.html)
      const modulepreloadLinks = chunkFiles
        .map(file => `    <link rel="modulepreload" href="./chunks/${file}">`)
        .join("\n")
      
      const cssLink = cssFile ? `    <link rel="stylesheet" href="./assets/${cssFile}">\n` : ""
      const preloadSection = modulepreloadLinks ? `${modulepreloadLinks}\n` : ""
      
      const archiveHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Archive - Personal Wayback</title>
${cssLink}${preloadSection}    <script type="module" src="./archive.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`
      fs.writeFileSync(archiveHtmlPath, archiveHtml)
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
    cssCodeSplit: false, // Ensure CSS is extracted to a single file
    rollupOptions: {
      input: {
        // UI pages
        popup: resolve(__dirname, "index.html"),
        // Archive uses main.tsx entry point - HTML will be generated during build
        archive: resolve(__dirname, "src/archive/main.tsx"),

        // Extension scripts (these will compile from TS to JS and be emitted)
        sw: resolve(__dirname, "sw.ts"),
        content: resolve(__dirname, "content.ts"),
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