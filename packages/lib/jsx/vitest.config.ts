import {defineConfig} from "vitest/config"

export default defineConfig({
    esbuild: {jsxFactory: "createElement", jsxFragment: "Fragment"},
    test: {environment: "jsdom", environmentOptions: {jsdom: {url: "https://example.test/"}}}
})
