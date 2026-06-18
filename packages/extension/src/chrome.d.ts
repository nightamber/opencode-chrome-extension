declare const chrome: {
  runtime: {
    connectNative(name: string): ChromePort
    onMessage: ChromeEvent<(message: unknown, sender: { tab?: ChromeTab }, sendResponse: (response?: unknown) => void) => boolean | void>
  }
  tabs: {
    captureVisibleTab(windowId?: number, options?: { format?: "png" | "jpeg"; quality?: number }): Promise<string>
    create(options: { active?: boolean; url?: string }): Promise<ChromeTab>
    get(tabId: number): Promise<ChromeTab>
    goBack(tabId?: number): Promise<void>
    query(query: { active?: boolean; currentWindow?: boolean; url?: string[] }): Promise<ChromeTab[]>
    reload(tabId?: number): Promise<void>
    sendMessage(tabId: number, message: unknown): Promise<unknown>
    update(tabId: number, options: { active?: boolean; url?: string }): Promise<ChromeTab>
  }
  scripting: {
    executeScript(options: { files: string[]; target: { tabId: number } }): Promise<unknown>
  }
}

type ChromeEvent<Listener extends (...args: never[]) => unknown> = {
  addListener(listener: Listener): void
}

type ChromePort = {
  onDisconnect: ChromeEvent<() => void>
  onMessage: ChromeEvent<(message: unknown) => void>
  postMessage(message: unknown): void
}

type ChromeTab = {
  active?: boolean
  id?: number
  title?: string
  url?: string
  windowId?: number
}
