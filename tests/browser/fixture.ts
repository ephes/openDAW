import {Events, Html} from "@opendaw/lib-dom"
import {HTML} from "@opendaw/lib-jsx"
import {RuntimeNotifier, Terminable, Terminator} from "@opendaw/lib-std"
import {RoomStatus} from "@/ui/RoomStatus"
import type {StudioService} from "@/service/StudioService"

const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const check = (condition: boolean, message: string) => {if (!condition) {throw new Error(message)}}
const failures: unknown[] = []
window.addEventListener("unhandledrejection", event => failures.push(event.reason))
const notices: string[] = []
RuntimeNotifier.install({
    info: async ({headline}) => {notices.push(headline ?? "")},
    approve: async () => false,
    progress: () => ({message: "", terminate() {}})
})

export const gestures = () => {
    const target = document.createElement("canvas")
    document.body.append(target)
    let doubles = 0
    let singles = 0
    const subscription = Events.subscribeDblDwn(target, () => doubles++)
    target.addEventListener("pointerdown", () => singles++)
    const send = (button = 0, clientX = 10, pointerType = "mouse") =>
        target.dispatchEvent(new PointerEvent("pointerdown", {button, clientX, clientY: 10, pointerType, cancelable: true}))
    send(); send(2); send(); send(0, 500); send(0, 500, "pen")
    check(doubles === 0, "unrelated pointers triggered a pair")
    send(0, 502, "pen"); send(0, 502, "pen")
    check(doubles === 1 && singles === 6, "pair/reset/single delivery mismatch")
    subscription.terminate()
    target.remove()
}

export const clipboard = async (reject: boolean) => {
    notices.length = 0
    Object.defineProperty(navigator, "clipboard", {configurable: true, value: {
        writeText: async () => {if (reject) {throw new DOMException("synthetic denial", "NotAllowedError")}}
    }})
    const lifecycle = new Terminator()
    const service = {
        roomAwareness: {catchupAndSubscribe: (observer: (value: unknown) => void) => {
            queueMicrotask(() => observer({getValue: () => ({roomName: "synthetic", clientID: 1,
                awareness: {getStates: () => new Map(), on() {}, off() {}}})}))
            return Terminable.Empty
        }},
        trafficMeter: {getValue: () => null}
    } as unknown as StudioService
    const room = RoomStatus({lifecycle, service})
    document.body.append(room)
    await settle()
    room.querySelector<HTMLElement>(".room-name")!.click()
    await settle()
    check(JSON.stringify(notices) === JSON.stringify([reject ? "Clipboard Error" : "Clipboard"]), "copy outcome was dishonest or notified twice")
    lifecycle.terminate()
    room.remove()
    check(failures.length === 0, "unhandled clipboard rejection")
}

export const html = async () => {
    const root = document.createElement("a")
    root.setAttribute("href", "javascript:window.syntheticPayload=1")
    root.setAttribute("onclick", "window.syntheticPayload=1")
    Html.sanitize(root)
    check(!root.hasAttribute("href") && !root.hasAttribute("onclick"), "root was not sanitized")
    const host = document.createElement("section")
    document.body.append(host)
    host.append(HTML({src: `<div onclick="window.syntheticPayload=1"><a href="javascript:window.syntheticPayload=1">bad</a>
        <iframe srcdoc="<script>parent.syntheticPayload=1</script>"></iframe>
        <img src="invalid:" onerror="window.syntheticPayload=1"><svg onload="window.syntheticPayload=1"><path d="M0 0L1 1"/></svg>
        <table><tr><td><strong>Help</strong></td></tr></table><a href="https://example.test/help">docs</a></div>`}))
    await settle()
    check(!host.querySelector("iframe, script, [onclick], [onerror], [onload], [srcdoc], [href^='javascript:']"), "active markup survived")
    check(host.querySelector("strong")?.textContent === "Help" && host.querySelector("svg path") !== null, "formatting was lost")
    check(!("syntheticPayload" in window), "payload executed")
    host.remove()
    const lifecycle = new Terminator()
    let resolve!: (response: Response) => void
    const pending = new Promise<Response>(yes => {resolve = yes})
    const retired = document.createElement("section")
    document.body.append(retired)
    retired.append(HTML({src: pending, lifecycle}))
    lifecycle.terminate()
    resolve(new Response("<p>retired</p>"))
    await settle()
    check(retired.querySelector("p") === null, "retired HTML published")
    retired.remove()
    check(failures.length === 0, "unhandled HTML rejection")
}

export type BrowserFixtures = {gestures: typeof gestures, clipboard: typeof clipboard, html: typeof html}

Object.assign(window, {fixtures: {gestures, clipboard, html}})
