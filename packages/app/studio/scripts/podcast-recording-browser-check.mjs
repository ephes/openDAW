#!/usr/bin/env node
// Automated browser verification for the OPFS-backed long-recording path.
// Drives the studio's /podcast-recording-test page via Playwright Core
// against the system Chrome. No microphone / hardware required.
//
// Exit codes:
//   0 — recording test reported status="pass" within the timeout window.
//   1 — recording test reported status="fail" or "error".
//   2 — environment setup failed (server, browser launch, navigation, timeout).
//
// Usage: node scripts/podcast-recording-browser-check.mjs [--duration=N]

import {createReadStream, statSync} from "node:fs"
import {createServer as createHttpServer} from "node:http"
import {createServer as createTcpServer} from "node:net"
import {extname, join, normalize, resolve as resolvePath} from "node:path"
import {fileURLToPath} from "node:url"
import {chromium} from "playwright-core"

const HERE = fileURLToPath(new URL("./", import.meta.url))
const DIST_DIR = resolvePath(HERE, "../dist")

const MIME_TYPES = new Map([
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".svg", "image/svg+xml"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
    [".png", "image/png"],
    [".jpg", "image/jpeg"],
    [".wasm", "application/wasm"],
    [".map", "application/json"],
    [".ico", "image/x-icon"]
])

const DEFAULT_DURATION = 2
const DEFAULT_CHANNELS = 2
const DEFAULT_FRAMES_PER_CHUNK = 12000
const RESULT_TIMEOUT_MS = 60_000
const PORT_RANGE_START = 9100
const PORT_RANGE_END = 9300

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
    const match = /^--([^=]+)=(.*)$/.exec(arg)
    return match === null ? [arg.replace(/^--/, ""), ""] : [match[1], match[2]]
}))

const duration = Number(args.duration ?? DEFAULT_DURATION) || DEFAULT_DURATION
const channels = Number(args.channels ?? DEFAULT_CHANNELS) || DEFAULT_CHANNELS
const framesPerChunk = Number(args.framesPerChunk ?? DEFAULT_FRAMES_PER_CHUNK) || DEFAULT_FRAMES_PER_CHUNK
const showBrowser = "headed" in args
const chromeExecutable = args.chrome ?? process.env.CHROME_EXECUTABLE
    ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

const probeFreePort = async () => {
    for (let port = PORT_RANGE_START; port < PORT_RANGE_END; port++) {
        const free = await new Promise(resolve => {
            const probe = createTcpServer()
            probe.on("error", () => resolve(false))
            probe.listen(port, "127.0.0.1", () => {
                probe.close(() => resolve(true))
            })
        })
        if (free) {return port}
    }
    throw new Error("no free port found in probe range")
}

const safeFileFor = (urlPath) => {
    const trimmed = decodeURIComponent(urlPath.split("?")[0])
    const candidate = normalize(join(DIST_DIR, trimmed))
    if (!candidate.startsWith(DIST_DIR)) {return null}
    if (statSafe(candidate)?.isDirectory()) {
        const fallback = join(candidate, "index.html")
        return statSafe(fallback) === null ? null : fallback
    }
    return statSafe(candidate) === null ? null : candidate
}

const statSafe = (path) => {
    try {return statSync(path)} catch {return null}
}

const startStaticServer = (port) => new Promise((resolve, reject) => {
    const server = createHttpServer((request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405)
            response.end()
            return
        }
        const filePath = safeFileFor(request.url ?? "/")
        if (filePath === null) {
            response.writeHead(404, {"content-type": "text/plain"})
            response.end("not found")
            return
        }
        const ext = extname(filePath).toLowerCase()
        const type = MIME_TYPES.get(ext) ?? "application/octet-stream"
        response.writeHead(200, {
            "content-type": type,
            "cross-origin-opener-policy": "same-origin",
            "cross-origin-embedder-policy": "require-corp",
            "cross-origin-resource-policy": "cross-origin",
            "cache-control": "no-store"
        })
        if (request.method === "HEAD") {
            response.end()
            return
        }
        createReadStream(filePath).pipe(response)
    })
    server.on("error", reject)
    server.listen(port, "127.0.0.1", () => {
        resolve({
            server,
            stop: () => new Promise(closeResolve => server.close(() => closeResolve()))
        })
    })
})

const main = async () => {
    if (statSafe(DIST_DIR) === null) {
        console.error(`dist directory missing at ${DIST_DIR}. Run 'npx vite build' first.`)
        process.exit(2)
    }
    const port = await probeFreePort()
    console.error(`port: ${port}`)
    const server = await startStaticServer(port)
    let exitCode = 2
    try {
        console.error(`launching Chrome (${chromeExecutable})`)
        const browser = await chromium.launch({
            headless: !showBrowser,
            executablePath: chromeExecutable,
            args: [
                "--autoplay-policy=no-user-gesture-required",
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
                "--enable-features=SharedArrayBuffer",
                "--no-sandbox"
            ]
        })
        try {
            const context = await browser.newContext({
                ignoreHTTPSErrors: true,
                permissions: ["microphone"]
            })
            const page = await context.newPage()
            page.on("console", message => {
                if (message.type() === "error") {
                    console.error(`[chrome:${message.type()}] ${message.text()}`)
                } else {
                    console.error(`[chrome] ${message.text()}`)
                }
            })
            page.on("pageerror", error => console.error(`[chrome:pageerror] ${String(error)}`))
            const url = `http://127.0.0.1:${port}/podcast-recording-test.html?autorun=1`
                + `&duration=${duration}&channels=${channels}&framesPerChunk=${framesPerChunk}`
            console.error(`navigating: ${url}`)
            const navResponse = await page.goto(url, {waitUntil: "domcontentloaded", timeout: 30_000})
            if (navResponse === null || !navResponse.ok()) {
                console.error(`navigation failed: status=${navResponse?.status() ?? "null"}`)
                exitCode = 2
                return
            }
            const isolated = await page.evaluate(() => Boolean(self.crossOriginIsolated))
            console.error(`crossOriginIsolated=${isolated}`)
            const sabAvailable = await page.evaluate(() => typeof SharedArrayBuffer !== "undefined")
            console.error(`SharedArrayBuffer=${sabAvailable}`)
            if (!isolated || !sabAvailable) {
                console.error("environment is missing crossOriginIsolated or SharedArrayBuffer")
                exitCode = 2
                return
            }
            console.error(`waiting for [data-test-status] (timeout=${RESULT_TIMEOUT_MS}ms)`)
            await page.waitForFunction(() => {
                const element = document.getElementById("status")
                const value = element?.getAttribute("data-test-status") ?? ""
                return value === "pass" || value === "fail" || value === "error"
            }, {timeout: RESULT_TIMEOUT_MS})
            const status = await page.getAttribute("#status", "data-test-status")
            const summary = await page.getAttribute("#log", "data-test-summary")
            const recordingId = await page.getAttribute("#log", "data-test-recording-id")
            const logText = await page.evaluate(() => document.getElementById("log")?.textContent ?? "")
            console.error("---")
            console.log(JSON.stringify({status, summary, recordingId, port, duration, channels, framesPerChunk}, null, 2))
            console.error("--- recording log ---")
            console.error(logText)
            console.error("--- end log ---")
            if (status === "pass") {exitCode = 0}
            else if (status === "fail") {exitCode = 1}
            else {exitCode = 2}
        } finally {
            await browser.close()
        }
    } finally {
        await server.stop()
    }
    return exitCode
}

main()
    .then(code => process.exit(code ?? 2))
    .catch(error => {
        console.error(`unexpected: ${String(error?.stack ?? error)}`)
        process.exit(2)
    })
