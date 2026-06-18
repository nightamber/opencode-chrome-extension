import {
  BrowserRequestSchema,
  NativeHostName,
  parseBrowserParams,
  type BrowserRequest,
  type BrowserResponse,
  type TabInfo,
} from "@opencode-chrome-extension/shared"

let nativePort: ChromePort | undefined
let selectedTabId: number | undefined

connectNativeHost()

function connectNativeHost() {
  try {
    nativePort = chrome.runtime.connectNative(NativeHostName)
    nativePort.onMessage.addListener((message) => void handleNativeMessage(message))
    nativePort.onDisconnect.addListener(() => {
      nativePort = undefined
      setTimeout(connectNativeHost, 1000)
    })
  } catch {
    setTimeout(connectNativeHost, 1000)
  }
}

async function handleNativeMessage(message: unknown) {
  const parsed = BrowserRequestSchema.safeParse(message)
  if (!parsed.success) return

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
  }
}

async function execute(request: BrowserRequest) {
  switch (request.method) {
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
      const tab = await chrome.tabs.get(await targetTabId(params.tabId))
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      return { dataUrl, title: tab.title, url: tab.url }
    }
    case "domSnapshot": {
      const params = parseBrowserParams(request.method, request.params)
      return await sendContentMessage(await targetTabId(params.tabId), { type: "domSnapshot" })
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
    return await chrome.tabs.sendMessage(tabId, message)
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
    return await chrome.tabs.sendMessage(tabId, message)
  }
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
