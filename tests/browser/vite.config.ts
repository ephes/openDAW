import {defineConfig} from "vite"
import {fileURLToPath} from "node:url"

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    publicDir: fileURLToPath(new URL("../../packages/app/studio/public", import.meta.url)),
    resolve: {alias: {
        "@": fileURLToPath(new URL("../../packages/app/studio/src", import.meta.url)),
        "@processors": fileURLToPath(new URL("../../packages/studio/core-processors/src", import.meta.url))
    }},
    esbuild: {jsxFactory: "createElement", jsxFragment: "Fragment"},
    // Scan dynamic fixtures too: a cold dependency cache otherwise reloads mid-test.
    optimizeDeps: {entries: ["index.html", "script-worklet.ts", "r120-studio.ts", "r123-ownership.ts", "r126-editors.ts", "r130-selection.ts", "r130-modular.ts", "r130-opfs.ts", "r134-interactions.ts", "r135-revamp.ts"]},
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
