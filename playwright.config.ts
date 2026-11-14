import {defineConfig} from "@playwright/test"

export default defineConfig({
    testDir: "./tests/browser",
    outputDir: "./.cache/browser-results",
    workers: 1,
    reporter: "list",
    use: {baseURL: "http://127.0.0.1:4179", browserName: "chromium", headless: true},
    webServer: {
        command: "vite --config tests/browser/vite.config.ts",
        url: "http://127.0.0.1:4179",
        reuseExistingServer: false
    }
})
