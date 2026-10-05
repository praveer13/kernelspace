import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"
import { inspectAttr } from 'plugin-inspect-react-code'

/*
 * The app's Content-Security-Policy (spec wave-1 §14.2, PLAN §7.3). No 'unsafe-eval':
 * Capstone learner code runs in its own sandboxed frame (src/lib/capstone/sandbox.ts).
 * 'wasm-unsafe-eval' covers Forge, Fleet and the real engine. 'unsafe-inline' styles
 * stay for Radix and React style injection. A meta CSP does not govern workers
 * (gen-worker.js imports transformers.js from jsdelivr) and cannot set frame-ancestors.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://giscus.app",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://cdn.jsdelivr.net https://huggingface.co https://*.huggingface.co https://*.hf.co",
  "worker-src 'self' blob:",
  "frame-src 'self' https://giscus.app",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

/* Build only: Vite's dev server injects inline scripts the policy would block. */
function metaCsp(): Plugin {
  const anchor = /<meta charset="UTF-8"\s*\/?>/i
  return {
    name: 'kernelspace-meta-csp',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!anchor.test(html)) throw new Error('meta-csp: index.html lost its <meta charset>; the CSP goes right after it')
        // first in <head> after the charset, so it governs every script and stylesheet that follows
        return html.replace(anchor, (m) => `${m}\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`)
      },
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages: the Actions workflow sets VITE_BASE to "/<repo>/" for
  // project sites; user/org sites (*.github.io) and local dev use "/".
  base: process.env.VITE_BASE ?? '/',
  plugins: [inspectAttr(), react(), metaCsp()],
  build: {
    // verify:bundle walks dist/.vite/manifest.json to measure each route's static JS + CSS closure.
    manifest: true,
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
