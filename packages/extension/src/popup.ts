type PopupStatus = {
  activeRequests?: number
  busy?: boolean
  connected?: boolean
  error?: string
  selectedTab?: {
    id: number
    title?: string
    url?: string
  }
  version?: string
}

const statusPill = requireElement("statusPill")
const statusText = requireElement("statusText")
const statusDetail = requireElement("statusDetail")
const versionText = requireElement("versionText")
const settingsButton = requireElement("settingsButton")

settingsButton.addEventListener("click", () => {
  void chrome.tabs.create({ active: true, url: `chrome://extensions/?id=${chrome.runtime.id}` })
})
void refresh()

async function refresh() {
  setPending()
  try {
    renderStatus((await chrome.runtime.sendMessage({ type: "popupStatus" })) as PopupStatus)
  } catch (error) {
    renderStatus({
      connected: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function renderStatus(status: PopupStatus) {
  statusPill.className = `pill ${status.busy ? "busy" : status.connected ? "connected" : "disconnected"}`
  statusText.textContent = status.busy ? "Running" : status.connected ? "Connected" : "Disconnected"
  statusDetail.textContent = status.error ?? statusMessage(status)
  versionText.textContent = status.version ? `Version v${status.version}` : "Version -"
}

function setPending() {
  statusPill.className = "pill pending"
  statusText.textContent = "Checking"
  statusDetail.textContent = "Checking Chrome native host connection."
  versionText.textContent = "Version -"
}

function statusMessage(status: PopupStatus) {
  if (status.busy) return "OpenCode is currently using Chrome."
  if (status.connected) return "Chrome native host is connected and ready."
  return "Chrome native host is not connected. Reinstall the native host or reload this extension."
}

function requireElement(id: string) {
  const element = document.getElementById(id)
  if (!element) throw new Error(`Missing popup element ${id}`)
  return element
}
