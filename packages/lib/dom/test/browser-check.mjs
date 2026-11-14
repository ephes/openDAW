import assert from "node:assert/strict"
import {fileURLToPath} from "node:url"
import {build} from "esbuild"
import {chromium} from "playwright"

const {outputFiles} = await build({
    stdin: {
        contents: `import {Dragging} from "./dragging";
            import {AnimationFrame} from "./frames";
            import {Shortcut, ShortcutManager} from "./shortcut-manager";
            import {Option} from "@opendaw/lib-std";
            Object.assign(globalThis, {Dragging, AnimationFrame, Shortcut, ShortcutManager, Option});`,
        resolveDir: fileURLToPath(new URL("../src", import.meta.url))
    },
    bundle: true, write: false, platform: "browser", target: "esnext"
})
const browser = await chromium.launch({headless: true})
try {
    const page = await browser.newPage()
    await page.setContent(`<style>#target {width:300px;height:100px;touch-action:none}</style>
        <div id="target">Drag</div><div id="editable" contenteditable="true"><span id="child">text</span>
        <span id="noneditable" contenteditable="false">canvas</span></div><div id="shadow"></div>`)
    await page.addScriptTag({content: outputFiles[0].text})
    await page.evaluate(() => {
        globalThis.failures = []
        window.addEventListener("error", event => {failures.push(event.error.message); event.preventDefault()})
    })
    const point = await page.locator("#target").boundingBox()
    const down = async () => {await page.mouse.move(point.x + 100, point.y + 50); await page.mouse.down()}
    const frames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const read = () => page.evaluate(() => ({...counts, failures: [...failures], captured: target.hasPointerCapture(pointerId)}))

    for (const hook of ["approve", "cancel", "finally"]) {
        await page.evaluate(hook => {
            globalThis.target = document.querySelector("#target")
            globalThis.counts = {update: 0, approve: 0, cancel: 0, finally: 0}
            globalThis.pointerId = -1
            failures.length = 0
            let fail = true
            const terminal = name => () => {
                counts[name]++
                if (name === hook && fail) {fail = false; throw new Error(hook)}
            }
            globalThis.attachment = Dragging.attach(target, event => {
                pointerId = event.pointerId
                return Option.wrap({update: () => counts.update++, approve: terminal("approve"),
                    cancel: terminal("cancel"), finally: terminal("finally")})
            }, {permanentUpdates: true})
            AnimationFrame.start(window)
        }, hook)
        await down()
        assert.equal((await read()).captured, true)
        if (hook === "cancel") {await page.keyboard.press("Escape")}
        await page.mouse.up()
        const settled = await read()
        assert.deepEqual(settled.failures, [hook])
        assert.equal(settled.finally, 1)
        assert.equal(settled.captured, false)
        await page.mouse.move(point.x + 130, point.y + 60)
        await frames()
        assert.equal((await read()).update, settled.update)
        await down()
        await page.mouse.up()
        assert.equal((await read()).finally, 2)
        await page.evaluate(() => {attachment.terminate(); AnimationFrame.terminate()})
    }
    await page.evaluate(() => {
        globalThis.counts = {update: 0, cancel: 0, approve: 0, finally: 0}
        globalThis.attachment = Dragging.attach(target, event => {
            pointerId = event.pointerId
            return Option.wrap({update: () => counts.update++, cancel: () => counts.cancel++,
                approve: () => counts.approve++, finally: () => counts.finally++})
        }, {immediate: true, permanentUpdates: true})
        AnimationFrame.start(window)
    })
    await down()
    assert.equal((await read()).captured, true)
    await page.evaluate(() => {attachment.terminate(); attachment.terminate()})
    const disposed = await read()
    await page.mouse.up()
    await frames()
    assert.deepEqual(await read(), disposed)
    assert.equal(disposed.cancel, 1)
    assert.equal(disposed.approve, 0)
    assert.equal(disposed.finally, 1)
    assert.equal(disposed.captured, false)
    await page.evaluate(() => AnimationFrame.terminate())
    console.log("PASS native pointer capture, throwing settlement, fresh drag and owner disposal")

    const keyboard = await page.evaluate(() => {
        const manager = ShortcutManager.get(), context = manager.createContext(() => true, "browser", 100)
        const calls = {delete: 0, space: 0}
        context.register(Shortcut.of("Delete"), () => calls.delete++)
        context.register(Shortcut.of("Space"), () => calls.space++, {activeInTextField: true})
        const listener = event => manager.handleEvent(event)
        window.addEventListener("keydown", listener)
        const send = (target, code, composing = false) => {
            const event = new KeyboardEvent("keydown", {key: code, code, bubbles: true, composed: true,
                cancelable: true, isComposing: composing})
            target.dispatchEvent(event)
            return event.defaultPrevented
        }
        const child = document.querySelector("#child"), noneditable = document.querySelector("#noneditable")
        const input = document.querySelector("#shadow").attachShadow({mode: "open"}).appendChild(document.createElement("input"))
        try {
            return {inherited: child.isContentEditable,
                composingDelete: send(child, "Delete", true), composingSpace: send(child, "Space", true),
                nested: send(child, "Delete"), shadow: send(input, "Delete"), optedIn: send(child, "Space"),
                noneditable: send(noneditable, "Delete"), canvas: send(document.body, "Delete"), calls}
        } finally {context.terminate(); window.removeEventListener("keydown", listener)}
    })
    assert.deepEqual(keyboard, {inherited: true, composingDelete: false, composingSpace: false,
        nested: false, shadow: false, optedIn: true, noneditable: true, canvas: true, calls: {delete: 2, space: 1}})
    // Native browser editing still handles Delete through the actual manager.
    await page.evaluate(() => {
        const context = ShortcutManager.get().createContext(() => true, "native-edit", 100)
        context.register(Shortcut.of("Delete"), () => {throw new Error("global Delete stole editing")})
        globalThis.editContext = context
        globalThis.keyListener = event => ShortcutManager.get().handleEvent(event)
        window.addEventListener("keydown", keyListener)
        const text = document.querySelector("#child").firstChild
        const range = document.createRange()
        range.setStart(text, 0); range.collapse(true)
        document.querySelector("#editable").focus()
        getSelection().removeAllRanges(); getSelection().addRange(range)
    })
    await page.keyboard.press("Delete")
    assert.equal(await page.locator("#child").textContent(), "ext")
    await page.evaluate(() => {editContext.terminate(); window.removeEventListener("keydown", keyListener)})
    console.log("PASS composing Delete/Space, inherited editable, shadow input, opt-in and native Delete")
} finally {
    await browser.close()
}
