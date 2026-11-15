import {defineConfig} from "vite"
import {fileURLToPath} from "node:url"

export default defineConfig({
    root: fileURLToPath(new URL(".", import.meta.url)),
    resolve: {alias: {"@": fileURLToPath(new URL("../../packages/app/studio/src", import.meta.url))}},
    esbuild: {jsxFactory: "createElement", jsxFragment: "Fragment"},
    // Scan the worklet too: a cold dependency cache otherwise re-optimizes and reloads mid-test.
    optimizeDeps: {entries: ["index.html", "script-worklet.ts"]},
    server: {host: "127.0.0.1", port: 4179, strictPort: true}
})
