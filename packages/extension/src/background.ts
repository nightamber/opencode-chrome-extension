import {
  BrowserRequestSchema,
  BrowserResponseSchema,
  NativeHostName,
  parseBrowserParams,
  type BrowserRequest,
  type BrowserResponse,
  type TabInfo,
} from "@opencode-chrome-extension/shared"

let nativePort: ChromePort | undefined
let selectedTabId: number | undefined
let activeRequests = 0
const minBusyVisibleMs = 2000
let busyVisibleUntil = 0
let visibleBusy = false
let activityClearTimer: ReturnType<typeof setTimeout> | undefined
let actionRenderQueue = Promise.resolve()
const pendingNativeResponses = new Map<string, (response: BrowserResponse) => void>()

connectNativeHost()
queueActionRender()

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isPopupMessage(message)) return
  void popupStatus()
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        connected: false,
        busy: visibleBusy || activeRequests > 0,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  return true
})

function connectNativeHost() {
  try {
    nativePort = chrome.runtime.connectNative(NativeHostName)
    nativePort.onMessage.addListener((message) => void handleNativePortMessage(message))
    nativePort.onDisconnect.addListener(() => {
      nativePort = undefined
      for (const resolve of pendingNativeResponses.values()) {
        resolve({
          id: "disconnect",
          error: {
            code: "native_disconnected",
            message: "Native host disconnected",
          },
        })
      }
      pendingNativeResponses.clear()
      setTimeout(connectNativeHost, 1000)
    })
  } catch {
    setTimeout(connectNativeHost, 1000)
  }
}

async function handleNativePortMessage(message: unknown) {
  const response = BrowserResponseSchema.safeParse(message)
  if (response.success && (response.data.result !== undefined || response.data.error !== undefined)) {
    pendingNativeResponses.get(response.data.id)?.(response.data)
    pendingNativeResponses.delete(response.data.id)
    return
  }

  await handleNativeMessage(message)
}

async function handleNativeMessage(message: unknown) {
  const parsed = BrowserRequestSchema.safeParse(message)
  if (!parsed.success) return

  beginActivity()
  try {
    nativePort?.postMessage({
      id: parsed.data.id,
      result: await execute(parsed.data),
    } satisfies BrowserResponse)
  } catch (error) {
    nativePort?.postMessage({
      id: parsed.data.id,
      error: {
        code: "chrome_error",
        message: error instanceof Error ? error.message : String(error),
      },
    } satisfies BrowserResponse)
  } finally {
    endActivity()
  }
}

async function execute(request: BrowserRequest) {
  switch (request.method) {
    case "activity": {
      const params = parseBrowserParams(request.method, request.params)
      markActivity(params.durationMs)
      return { busy: true, method: params.method }
    }
    case "status":
      return { extension: true }
    case "tabsList":
      return { tabs: (await chrome.tabs.query({})).flatMap(tabInfo) }
    case "tabSelect": {
      const params = parseBrowserParams(request.method, request.params)
      selectedTabId = params.tabId
      const tab = await chrome.tabs.update(params.tabId, { active: true })
      return { tab: tabInfo(tab)[0] }
    }
    case "tabNew": {
      const params = parseBrowserParams(request.method, request.params)
      const tab = await chrome.tabs.create({ active: true, url: params?.url })
      selectedTabId = tab.id
      return { tab: tabInfo(tab)[0] }
    }
    case "tabGoto": {
      const params = parseBrowserParams(request.method, request.params)
      const tab = await chrome.tabs.update(await targetTabId(params.tabId), { active: true, url: params.url })
      selectedTabId = tab.id
      return { tab: tabInfo(tab)[0] }
    }
    case "tabScreenshot": {
      const params = parseBrowserParams(request.method, request.params)
      const tabId = await targetTabId(params.tabId)
      await sendContentMessage(tabId, { type: "waitForLoad", timeoutMs: 10000, quietMs: 800 })
      const tab = await chrome.tabs.get(tabId)
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      return { dataUrl, title: tab.title, url: tab.url }
    }
    case "waitForLoad": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), {
        type: "waitForLoad",
        timeoutMs: params.timeoutMs,
        quietMs: params.quietMs,
      })
    }
    case "domSnapshot": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), { type: "domSnapshot" })
    }
    case "pageContent": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), {
        type: "pageContent",
        timeoutMs: params.timeoutMs,
        quietMs: params.quietMs,
        maxChars: params.maxChars,
        includeImages: params.includeImages,
        maxImages: params.maxImages,
      })
    }
    case "pageAssets": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), {
        type: "pageAssets",
        timeoutMs: params.timeoutMs,
        quietMs: params.quietMs,
        maxAssets: params.maxAssets,
      })
    }
    case "click": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), { type: "click", x: params.x, y: params.y })
    }
    case "type": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), { type: "type", text: params.text })
    }
    case "keypress": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), { type: "keypress", key: params.key })
    }
    case "scroll": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), {
        type: "scroll",
        deltaX: params.deltaX,
        deltaY: params.deltaY,
        durationMs: params.durationMs,
        x: params.x,
        y: params.y,
      })
    }
    case "evaluate": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), { type: "evaluate", script: params.script })
    }
    case "consoleLogs": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), { type: "consoleLogs", limit: params.limit })
    }
  }
}

async function targetTabId(tabId?: number) {
  if (tabId) return tabId
  if (selectedTabId) return selectedTabId
  const active = (await chrome.tabs.query({ active: true, currentWindow: true })).flatMap(tabInfo).at(0)
  if (!active) throw new Error("No active Chrome tab found")
  selectedTabId = active.id
  return active.id
}

async function sendContentMessage(tabId: number, message: unknown) {
  try {
    return contentResult(await chrome.tabs.sendMessage(tabId, message))
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
    return contentResult(await chrome.tabs.sendMessage(tabId, message))
  }
}

function contentResult(response: unknown) {
  if (typeof response === "object" && response !== null && "error" in response && typeof response.error === "string") {
    throw new Error(response.error)
  }
  return response
}

function tabInfo(tab: ChromeTab): TabInfo[] {
  if (!tab.id) return []
  return [
    {
      active: tab.active,
      id: tab.id,
      title: tab.title,
      url: tab.url,
      windowId: tab.windowId,
    },
  ]
}

function beginActivity() {
  activeRequests++
  markActivity()
}

function markActivity(durationMs = minBusyVisibleMs) {
  if (activityClearTimer) {
    clearTimeout(activityClearTimer)
    activityClearTimer = undefined
  }
  busyVisibleUntil = Math.max(busyVisibleUntil, Date.now() + durationMs)
  visibleBusy = true
  queueActionRender()
}

function endActivity() {
  activeRequests = Math.max(0, activeRequests - 1)
  if (activeRequests > 0) {
    visibleBusy = true
    queueActionRender()
    return
  }

  scheduleActivityClear()
}

function scheduleActivityClear() {
  if (activityClearTimer) {
    clearTimeout(activityClearTimer)
    activityClearTimer = undefined
  }

  if (activeRequests > 0) {
    visibleBusy = true
    queueActionRender()
    return
  }

  const remainingMs = Math.max(0, busyVisibleUntil - Date.now())
  if (remainingMs === 0) {
    visibleBusy = false
    queueActionRender()
    return
  }

  activityClearTimer = setTimeout(() => {
    activityClearTimer = undefined
    if (activeRequests > 0) return
    if (Date.now() < busyVisibleUntil) {
      scheduleActivityClear()
      return
    }
    visibleBusy = false
    queueActionRender()
  }, remainingMs)
}

function queueActionRender() {
  actionRenderQueue = actionRenderQueue
    .catch(() => undefined)
    .then(() => renderActionState())
}

async function renderActionState() {
  const busy = activeRequests > 0 || visibleBusy || Date.now() < busyVisibleUntil
  const tasks = [
    chrome.action.setBadgeText({ text: busy ? "RUN" : "" }),
    chrome.action.setBadgeBackgroundColor({ color: busy ? "#dc2626" : "#6b7280" }),
    chrome.action.setIcon({ path: actionIconPath(busy) }),
    chrome.action.setTitle({ title: busy ? "opencode is using Chrome" : "opencode Chrome Control" }),
  ]
  await Promise.all(tasks.map((task) => task.catch(() => undefined)))
}

function actionIconPath(busy: boolean) {
  const state = busy ? "busy" : "idle"
  return {
    "16": `icons/${state}-16.png`,
    "32": `icons/${state}-32.png`,
    "48": `icons/${state}-48.png`,
    "128": `icons/${state}-128.png`,
  }
}

async function popupStatus() {
  const selectedTab = selectedTabId ? await chrome.tabs.get(selectedTabId).then((tab) => tabInfo(tab)[0]).catch(() => undefined) : undefined
  const manifest = chrome.runtime.getManifest()
  const nativeStatus = await pingNativeHost().catch((error) => ({
    error: {
      code: "native_ping_failed",
      message: error instanceof Error ? error.message : String(error),
    },
  }))
  const connected = "result" in nativeStatus && typeof nativeStatus.result === "object" && nativeStatus.result !== null
  return {
    activeRequests,
    busy: activeRequests > 0 || visibleBusy || Date.now() < busyVisibleUntil,
    connected,
    error: connected ? undefined : nativeStatus.error?.message ?? "Native host did not respond",
    extensionName: manifest.name,
    nativeStatus: connected ? nativeStatus.result : undefined,
    selectedTab,
    version: manifest.version,
  }
}

async function pingNativeHost() {
  return await postNativeRequest({
    id: crypto.randomUUID(),
    method: "status",
    params: {},
  })
}

async function postNativeRequest(request: BrowserRequest, timeoutMs = 1500) {
  if (!nativePort) throw new Error("Native host port is not open")

  return await new Promise<BrowserResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingNativeResponses.delete(request.id)
      reject(new Error("Native host did not respond to status ping"))
    }, timeoutMs)

    pendingNativeResponses.set(request.id, (response) => {
      clearTimeout(timeout)
      resolve(response)
    })
    nativePort?.postMessage(request)
  })
}

function isPopupMessage(message: unknown): message is { type: "popupStatus" } {
  return typeof message === "object" && message !== null && "type" in message && message.type === "popupStatus"
}
