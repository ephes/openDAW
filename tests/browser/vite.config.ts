import {defineConfig} from "vite"
import {fileURLToPath} from "node:url"

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    resolve: {alias: {"@": fileURLToPath(new URL("../../packages/app/studio/src", import.meta.url))}},
    esbuild: {jsxFactory: "createElement", jsxFragment: "Fragment"},
    // Scan the worklet too: a cold dependency cache otherwise re-optimizes and reloads mid-test.
    optimizeDeps: {entries: ["index.html", "script-worklet.ts"]},
    // Match the studio's cross-origin isolation so SharedArrayBuffer-backed AudioData works.
    server: {
        host: "127.0.0.1", port: 4179, strictPort: true,
        headers: {
            "Cross-Origin-Opener-Policy": "same-origin",
            "Cross-Origin-Embedder-Policy": "require-corp",
            "Cross-Origin-Resource-Policy": "cross-origin"
        }
    }
})
