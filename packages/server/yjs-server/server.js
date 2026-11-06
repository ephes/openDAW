#!/usr/bin/env node

import https from "https"
import fs from "fs"
import * as number from "lib0/number"
import {attachCollaboration} from "./transport.js"
import {isAllowedOrigin} from "./policy.js"

const host = process.env.HOST || "0.0.0.0"
const port = number.parseInt(process.env.PORT || "443")
const isDev = process.env.NODE_ENV === "development"

const certConfig = isDev ? {
    key: fs.readFileSync("../../../certs/localhost-key.pem"),
    cert: fs.readFileSync("../../../certs/localhost.pem"),
} : {
    key: fs.readFileSync("/etc/letsencrypt/live/live.opendaw.studio/privkey.pem"),
    cert: fs.readFileSync("/etc/letsencrypt/live/live.opendaw.studio/fullchain.pem"),
}

const server = https.createServer(certConfig, (req, res) => {
    const origin = req.headers.origin
    if (origin && isAllowedOrigin(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin)
    }
    res.writeHead(200, {"Content-Type": "text/plain"})
    res.end("okay")
})

attachCollaboration(server)

server.listen(port, host, () => {
    console.log(`running at '${host}' on port ${port} (${isDev ? 'development' : 'production'})`)
    console.log(`- Yjs sync: wss://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`)
    console.log(`- WebRTC signaling: wss://${host === '0.0.0.0' ? 'localhost' : host}:${port}/signaling`)
})