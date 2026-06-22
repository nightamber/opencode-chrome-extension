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
    case "waitForLoad":
      return await waitForLoad(numberValue(message.timeoutMs ?? 10000, "timeoutMs"), numberValue(message.quietMs ?? 800, "quietMs"))
    case "domSnapshot":
      return { nodes: domSnapshot(), title: document.title, url: location.href }
    case "pageContent":
      return await pageContent(
        numberValue(message.timeoutMs ?? 10000, "timeoutMs"),
        numberValue(message.quietMs ?? 800, "quietMs"),
        numberValue(message.maxChars ?? 30000, "maxChars"),
        booleanValue(message.includeImages ?? true, "includeImages"),
        numberValue(message.maxImages ?? 20, "maxImages"),
      )
    case "pageAssets":
      return await pageAssets(
        numberValue(message.timeoutMs ?? 10000, "timeoutMs"),
        numberValue(message.quietMs ?? 800, "quietMs"),
        numberValue(message.maxAssets ?? 300, "maxAssets"),
      )
    case "click":
      return clickAt(numberValue(message.x, "x"), numberValue(message.y, "y"))
    case "type":
      return typeText(stringValue(message.text, "text"))
    case "keypress":
      return keypress(stringValue(message.key, "key"))
    case "scroll":
      return await scrollByCommand(message)
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

async function pageContent(timeoutMs: number, quietMs: number, maxChars: number, includeImages: boolean, maxImages: number) {
  await waitForLoad(timeoutMs, quietMs)
  const root = readableRoot()
  const text = normalizedBlockText(root.innerText || root.textContent || "")
  const headings = Array.from(root.querySelectorAll("h1,h2,h3"))
    .map((element) => normalizedText(element.textContent || ""))
    .filter(Boolean)
    .slice(0, 80)
  const links = Array.from(root.querySelectorAll("a[href]"))
    .map((element) => {
      const anchor = element as HTMLAnchorElement
      return {
        text: normalizedText(anchor.innerText || anchor.textContent || ""),
        href: anchor.href,
      }
    })
    .filter((link) => link.text || link.href)
    .slice(0, 120)

  return {
    title: document.title,
    url: location.href,
    readyState: document.readyState,
    source: root === document.body ? "body" : root.tagName.toLowerCase(),
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
    textLength: text.length,
    headings,
    images: includeImages ? scanPageAssets(maxImages).assets.map(imageSummary) : [],
    links,
  }
}

async function pageAssets(timeoutMs: number, quietMs: number, maxAssets: number) {
  await waitForLoad(timeoutMs, quietMs)
  return scanPageAssets(maxAssets)
}

function scanPageAssets(maxAssets: number) {
  const assets = new Map<string, PageAsset>()
  const inlineSvgs = Array.from(document.querySelectorAll("svg"))
    .map((svg, index) => ({
      id: `inline-svg-${index}`,
      markup: svg.outerHTML.slice(0, 20000),
      name: svg.getAttribute("aria-label") || svg.id || `Inline SVG ${index + 1}`,
    }))
    .slice(0, 100)

  for (const image of Array.from(document.images)) {
    const rect = image.getBoundingClientRect()
    addAsset(assets, image.currentSrc || image.src, {
      kind: "image",
      name: image.alt || filenameFromUrl(image.currentSrc || image.src) || "Image",
      sources: [{ kind: "element", tag: "img" }],
      visible: isVisibleRect(rect),
      width: image.naturalWidth || Math.round(rect.width),
      height: image.naturalHeight || Math.round(rect.height),
    })
    for (const url of srcsetUrls(image.srcset)) {
      addAsset(assets, url, {
        kind: "image",
        name: image.alt || filenameFromUrl(url) || "Image source",
        sources: [{ kind: "attribute", tag: "img", property: "srcset" }],
        visible: isVisibleRect(rect),
      })
    }
  }

  for (const source of Array.from(document.querySelectorAll("source[srcset]"))) {
    for (const url of srcsetUrls(source.getAttribute("srcset") || "")) {
      addAsset(assets, url, {
        kind: "image",
        name: filenameFromUrl(url) || "Picture source",
        sources: [{ kind: "attribute", tag: "source", property: "srcset" }],
        visible: false,
      })
    }
  }

  for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    for (const url of cssUrls(`${style.backgroundImage},${style.maskImage},${style.listStyleImage}`)) {
      addAsset(assets, url, {
        kind: "image",
        name: filenameFromUrl(url) || "CSS image",
        sources: [{ kind: "computedStyle", tag: element.tagName.toLowerCase(), property: "background/mask/list" }],
        visible: isVisibleRect(rect),
      })
    }
  }

  for (const entry of performance.getEntriesByType("resource")) {
    const resource = entry as PerformanceResourceTiming
    if (resource.initiatorType !== "img" && resource.initiatorType !== "css" && resource.initiatorType !== "image") continue
    addAsset(assets, resource.name, {
      kind: "image",
      name: filenameFromUrl(resource.name) || "Loaded image",
      sources: [{ kind: "resource", initiatorType: resource.initiatorType }],
      visible: false,
      transferSize: resource.transferSize,
    })
  }

  const list = Array.from(assets.values()).slice(0, maxAssets)
  return {
    assets: list,
    id: `assets-${Date.now()}`,
    inlineSvgs,
    pageUrl: location.href,
    summary: {
      imageCount: list.length,
      inlineSvgCount: inlineSvgs.length,
      totalCount: list.length + inlineSvgs.length,
      visibleImageCount: list.filter((asset) => asset.visible).length,
    },
    title: document.title,
  }
}

async function waitForLoad(timeoutMs: number, quietMs: number) {
  const started = Date.now()
  await waitUntil(() => document.readyState !== "loading", timeoutMs)

  let previous = contentSignature()
  let stableSince = Date.now()
  while (Date.now() - started < timeoutMs) {
    await delay(100)
    const current = contentSignature()
    if (current !== previous) {
      previous = current
      stableSince = Date.now()
      continue
    }
    if (Date.now() - stableSince >= quietMs) {
      return {
        loaded: true,
        readyState: document.readyState,
        url: location.href,
        title: document.title,
        textLength: normalizedBlockText((readableRoot().innerText || document.body?.innerText || "")).length,
      }
    }
  }

  return {
    loaded: false,
    readyState: document.readyState,
    url: location.href,
    title: document.title,
    textLength: normalizedBlockText((readableRoot().innerText || document.body?.innerText || "")).length,
  }
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

async function scrollByCommand(message: Record<string, unknown>) {
  const x = typeof message.x === "number" ? message.x : undefined
  const y = typeof message.y === "number" ? message.y : undefined
  const element = x === undefined || y === undefined ? undefined : document.elementFromPoint(x, y)
  const target = element instanceof HTMLElement ? scrollableParent(element) : undefined
  const deltaX = numberValue(message.deltaX ?? 0, "deltaX")
  const deltaY = numberValue(message.deltaY ?? 0, "deltaY")
  const durationMs = numberValue(message.durationMs ?? 450, "durationMs")

  if (target) {
    return await smoothScrollElement(target, deltaX, deltaY, durationMs)
  }

  return await smoothScrollWindow(deltaX, deltaY, durationMs)
}

async function smoothScrollWindow(deltaX: number, deltaY: number, durationMs: number) {
  const startX = window.scrollX
  const startY = window.scrollY
  const maxX = Math.max(0, document.documentElement.scrollWidth - window.innerWidth)
  const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight)
  const endX = clamp(startX + deltaX, 0, maxX)
  const endY = clamp(startY + deltaY, 0, maxY)

  await animateScroll(durationMs, (progress) => {
    window.scrollTo(startX + (endX - startX) * progress, startY + (endY - startY) * progress)
  })

  return { scrolled: startX !== endX || startY !== endY, x: window.scrollX, y: window.scrollY }
}

async function smoothScrollElement(target: HTMLElement, deltaX: number, deltaY: number, durationMs: number) {
  const startX = target.scrollLeft
  const startY = target.scrollTop
  const maxX = Math.max(0, target.scrollWidth - target.clientWidth)
  const maxY = Math.max(0, target.scrollHeight - target.clientHeight)
  const endX = clamp(startX + deltaX, 0, maxX)
  const endY = clamp(startY + deltaY, 0, maxY)

  await animateScroll(durationMs, (progress) => {
    target.scrollLeft = startX + (endX - startX) * progress
    target.scrollTop = startY + (endY - startY) * progress
  })

  return { scrolled: startX !== endX || startY !== endY, x: target.scrollLeft, y: target.scrollTop }
}

async function animateScroll(durationMs: number, apply: (progress: number) => void) {
  if (durationMs <= 0) {
    apply(1)
    return
  }

  await new Promise<void>((resolve) => {
    const startedAt = performance.now()
    const step = (now: number) => {
      const elapsed = now - startedAt
      const linear = clamp(elapsed / durationMs, 0, 1)
      const eased = 1 - Math.pow(1 - linear, 3)
      apply(eased)
      if (linear >= 1) {
        resolve()
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
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

function normalizedBlockText(value: string) {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

function readableRoot() {
  return (
    document.querySelector("article") ??
    document.querySelector("main") ??
    document.querySelector("[role='main']") ??
    document.body ??
    document.documentElement
  ) as HTMLElement
}

function contentSignature() {
  const root = readableRoot()
  return [
    document.readyState,
    location.href,
    root.innerText?.length ?? 0,
    document.querySelectorAll("main,article,h1,h2,h3,p,li,a,button,input").length,
  ].join(":")
}

async function waitUntil(predicate: () => boolean, timeoutMs: number) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started >= timeoutMs) return
    await delay(50)
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

type PageAsset = {
  id: string
  kind: "image"
  name: string
  sources: Array<Record<string, string>>
  url: string
  visible: boolean
  width?: number
  height?: number
  transferSize?: number
}

function addAsset(assets: Map<string, PageAsset>, rawUrl: string | undefined, input: Omit<PageAsset, "id" | "url">) {
  const url = absoluteUrl(rawUrl)
  if (!url || url.startsWith("data:")) return
  const existing = assets.get(url)
  if (existing) {
    existing.visible = existing.visible || input.visible
    existing.sources.push(...input.sources)
    existing.width ??= input.width
    existing.height ??= input.height
    existing.transferSize ??= input.transferSize
    return
  }
  assets.set(url, {
    ...input,
    id: `asset-${assets.size}`,
    url,
  })
}

function absoluteUrl(rawUrl: string | undefined) {
  if (!rawUrl) return
  try {
    return new URL(rawUrl, location.href).toString()
  } catch {
    return
  }
}

function srcsetUrls(value: string) {
  return value
    .split(",")
    .map((part) => part.trim().split(/\s+/, 1)[0])
    .filter(Boolean)
    .flatMap((url) => absoluteUrl(url) ?? [])
}

function cssUrls(value: string) {
  return Array.from(value.matchAll(/url\((["']?)(.*?)\1\)/g))
    .map((match) => match[2])
    .flatMap((url) => absoluteUrl(url) ?? [])
}

function filenameFromUrl(url: string) {
  try {
    const pathname = new URL(url, location.href).pathname
    return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) || "")
  } catch {
    return ""
  }
}

function isVisibleRect(rect: DOMRect) {
  return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth
}

function imageSummary(asset: PageAsset) {
  return {
    height: asset.height,
    id: asset.id,
    name: asset.name,
    sources: asset.sources.slice(0, 3),
    url: asset.url,
    visible: asset.visible,
    width: asset.width,
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function numberValue(value: unknown, name: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`)
  return value
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function stringValue(value: unknown, name: string) {
  if (typeof value !== "string") throw new Error(`${name} must be a string`)
  return value
}

function booleanValue(value: unknown, name: string) {
  if (typeof value !== "boolean") throw new Error(`${name} must be a boolean`)
  return value
}
