import { assertReadonlyEvaluateScript, type ConsoleLogInfo, type DomNodeInfo } from "@opencode-chrome-extension/shared"

const stateKey = "__opencodeChromeExtensionState"
const globalState = globalThis as typeof globalThis & {
  [stateKey]?: {
    installed: boolean
    logs: ConsoleLogInfo[]
  }
}

if (!globalState[stateKey]?.installed) {
  globalState[stateKey] = { installed: true, logs: [] }
  installConsoleCapture(globalState[stateKey].logs)
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    void Promise.resolve(handleMessage(message))
      .then(sendResponse)
      .catch((error) =>
        sendResponse({
          error: error instanceof Error ? error.message : String(error),
        }),
      )
    return true
  })
}

async function handleMessage(message: unknown) {
  if (!isObject(message) || typeof message.type !== "string") throw new Error("Invalid content command")

  switch (message.type) {
    case "domSnapshot":
      return { nodes: domSnapshot(), title: document.title, url: location.href }
    case "click":
      return clickAt(numberValue(message.x, "x"), numberValue(message.y, "y"))
    case "type":
      return typeText(stringValue(message.text, "text"))
    case "keypress":
      return keypress(stringValue(message.key, "key"))
    case "scroll":
      return scrollByCommand(message)
    case "evaluate":
      return evaluateReadonly(stringValue(message.script, "script"))
    case "consoleLogs":
      return {
        logs: (globalState[stateKey]?.logs ?? []).slice(-numberValue(message.limit ?? 50, "limit")),
      }
    default:
      throw new Error(`Unsupported content command ${message.type}`)
  }
}

function domSnapshot() {
  return Array.from(
    document.querySelectorAll(
      [
        "a[href]",
        "button",
        "input",
        "select",
        "textarea",
        "summary",
        "[role='button']",
        "[role='link']",
        "[role='checkbox']",
        "[role='textbox']",
        "[contenteditable='true']",
        "[tabindex]:not([tabindex='-1'])",
      ].join(","),
    ),
  )
    .map((element, index) => nodeInfo(element, index))
    .filter((node): node is DomNodeInfo => node !== undefined)
    .slice(0, 300)
}

function nodeInfo(element: Element, index: number): DomNodeInfo | undefined {
  const rect = element.getBoundingClientRect()
  const style = getComputedStyle(element)
  if (rect.width <= 0 || rect.height <= 0 || style.visibility === "hidden" || style.display === "none") return

  const html = element as HTMLElement
  const input = element instanceof HTMLInputElement ? element : undefined
  const text = normalizedText(html.innerText || element.textContent || input?.placeholder || "")
  return {
    id: `node-${index}`,
    tag: element.tagName.toLowerCase(),
    text: text || undefined,
    ariaLabel: element.getAttribute("aria-label") || undefined,
    role: element.getAttribute("role") || undefined,
    href: element instanceof HTMLAnchorElement ? element.href : undefined,
    value: input?.value || undefined,
    checked: input?.checked,
    disabled: input?.disabled || (element instanceof HTMLButtonElement ? element.disabled : undefined),
    rect: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    },
  } satisfies DomNodeInfo
}

function clickAt(x: number, y: number) {
  const element = document.elementFromPoint(x, y)
  if (!(element instanceof HTMLElement)) throw new Error(`No clickable element at ${x}, ${y}`)
  element.dispatchEvent(new MouseEvent("mousedown", mouseEventInit(x, y)))
  element.dispatchEvent(new MouseEvent("mouseup", mouseEventInit(x, y)))
  element.click()
  return { clicked: true }
}

function typeText(text: string) {
  const element = document.activeElement
  if (!element) throw new Error("No focused element for typing")

  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    const start = element.selectionStart ?? element.value.length
    const end = element.selectionEnd ?? element.value.length
    element.value = element.value.slice(0, start) + text + element.value.slice(end)
    element.selectionStart = start + text.length
    element.selectionEnd = start + text.length
    element.dispatchEvent(new InputEvent("input", { bubbles: true, data: text, inputType: "insertText" }))
    return { typed: true }
  }

  if (element instanceof HTMLElement && element.isContentEditable) {
    document.execCommand("insertText", false, text)
    return { typed: true }
  }

  throw new Error("Focused element does not accept text")
}

function keypress(key: string) {
  const target = document.activeElement ?? document.body
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key }))
  target.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key }))
  return { pressed: true }
}

function scrollByCommand(message: Record<string, unknown>) {
  const x = typeof message.x === "number" ? message.x : undefined
  const y = typeof message.y === "number" ? message.y : undefined
  const element = x === undefined || y === undefined ? undefined : document.elementFromPoint(x, y)
  const target = element instanceof HTMLElement ? scrollableParent(element) : undefined
  const deltaX = numberValue(message.deltaX ?? 0, "deltaX")
  const deltaY = numberValue(message.deltaY ?? 0, "deltaY")

  if (target) {
    target.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" })
    return { scrolled: true }
  }

  window.scrollBy({ left: deltaX, top: deltaY, behavior: "instant" })
  return { scrolled: true }
}

function evaluateReadonly(script: string) {
  assertReadonlyEvaluateScript(script)
  const value = Function(`"use strict"; return (${script});`)()
  return { value: serialize(value) }
}

function installConsoleCapture(logs: ConsoleLogInfo[]) {
  for (const level of ["debug", "info", "log", "warn", "error"] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      logs.push({
        level,
        message: args.map((arg) => (typeof arg === "string" ? arg : safeJson(arg))).join(" "),
        timestamp: Date.now(),
      })
      if (logs.length > 500) logs.splice(0, logs.length - 500)
      original(...args)
    }
  }
}

function scrollableParent(element: HTMLElement): HTMLElement | undefined {
  const parent = element.parentElement
  if (!parent) return
  const style = getComputedStyle(parent)
  if (/(auto|scroll)/.test(`${style.overflow}${style.overflowY}${style.overflowX}`)) return parent
  return scrollableParent(parent)
}

function mouseEventInit(x: number, y: number): MouseEventInit {
  return { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window }
}

function serialize(value: unknown): unknown {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value))
}

function normalizedText(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 200)
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function numberValue(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`)
  return value
}

function stringValue(value: unknown, name: string) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`)
  return value
}
