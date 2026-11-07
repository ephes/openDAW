import {defineConfig} from "vitest/config"
import {fileURLToPath} from "node:url"

export default defineConfig({
    test: {environment: "jsdom"},
    resolve: {alias: {"@": fileURLToPath(new URL("./src", import.meta.url))}}
})
