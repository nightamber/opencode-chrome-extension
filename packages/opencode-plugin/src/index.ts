import type { Plugin, ToolContext, ToolResult } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin/tool"
import {
  RuntimeConfigSchema,
  assertReadonlyEvaluateScript,
  runtimeConfigPath,
  type BrowserMethod,
  type BrowserResponse,
  type RuntimeConfig,
} from "@opencode-chrome-extension/shared"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"

type PluginOptions = {
  runtimeConfigPath?: string
}

const ChromePlugin: Plugin = async (_input, options?: PluginOptions) => {
  const client = new ChromeClient(options?.runtimeConfigPath)

  return {
    tool: {
      chrome_status: tool({
        description: "Check whether the OpenCode Chrome native host and extension are connected.",
        args: {},
        async execute() {
          return await client.status()
        },
      }),

      chrome_tabs_list: tool({
        description: "List open Chrome tabs from the user's current Chrome profile.",
        args: {},
        async execute() {
          return await client.command("tabsList", {})
        },
      }),

      chrome_tab_select: tool({
        description: "Select an existing Chrome tab as the default target for later Chrome tools.",
        args: {
          tabId: tool.schema.number().int().positive().describe("Chrome tab id from chrome_tabs_list."),
        },
        async execute(args, context) {
          await askChrome(context, "select tab", [`tab:${args.tabId}`])
          return await client.command("tabSelect", { tabId: args.tabId })
        },
      }),

      chrome_tab_new: tool({
        description: "Open a new Chrome tab, optionally at a URL.",
        args: {
          url: tool.schema.string().url().optional().describe("URL to open in the new tab."),
        },
        async execute(args, context) {
          await askChrome(context, "open new tab", args.url ? [args.url] : ["about:blank"])
          return await client.command("tabNew", args)
        },
      }),

      chrome_tab_goto: tool({
        description: "Navigate a Chrome tab to a URL.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          url: tool.schema.string().url().describe("URL to open."),
        },
        async execute(args, context) {
          await askChrome(context, "navigate", [args.url])
          return await client.command("tabGoto", args)
        },
      }),

      chrome_tab_screenshot: tool({
        description: "Wait for the page to become stable, then capture a screenshot of the selected or specified Chrome tab.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
        },
        async execute(args) {
          const response = await client.commandObject("tabScreenshot", args)
          if (typeof response.dataUrl !== "string") return jsonResult(response)
          return await screenshotResult(response.dataUrl, response.title, response.url)
        },
      }),

      chrome_dom_snapshot: tool({
        description: "Read a compact snapshot of visible interactive elements in a Chrome tab.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
        },
        async execute(args) {
          return await client.command("domSnapshot", args)
        },
      }),

      chrome_wait_for_load: tool({
        description: "Wait until a Chrome tab finishes loading and its visible page content is briefly stable.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          timeoutMs: tool.schema.number().int().min(100).max(60000).default(10000).describe("Maximum time to wait."),
          quietMs: tool.schema.number().int().min(100).max(5000).default(800).describe("How long content must stay unchanged."),
        },
        async execute(args) {
          return await client.command("waitForLoad", args)
        },
      }),

      chrome_page_content: tool({
        description:
          "Read the current Chrome tab's rendered page content as text, including SPA-rendered docs pages. Use this before webfetch when the user asks to summarize or inspect a page in Chrome.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          timeoutMs: tool.schema.number().int().min(100).max(60000).default(10000).describe("Maximum time to wait for page content."),
          quietMs: tool.schema.number().int().min(100).max(5000).default(800).describe("How long content must stay unchanged."),
          maxChars: tool.schema.number().int().min(1000).max(100000).default(30000).describe("Maximum text characters to return."),
          includeImages: tool.schema.boolean().default(true).describe("Include image summaries with the page text."),
          maxImages: tool.schema.number().int().min(0).max(100).default(20).describe("Maximum image summaries to include."),
        },
        async execute(args) {
          return await client.command("pageContent", args)
        },
      }),

      chrome_page_assets: tool({
        description:
          "Inventory image assets from the current rendered Chrome page, including img/picture sources, CSS background images, loaded image resources, and inline SVGs.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          timeoutMs: tool.schema.number().int().min(100).max(60000).default(10000).describe("Maximum time to wait for page assets."),
          quietMs: tool.schema.number().int().min(100).max(5000).default(800).describe("How long page content must stay unchanged."),
          maxAssets: tool.schema.number().int().min(10).max(1000).default(300).describe("Maximum number of asset entries to return."),
        },
        async execute(args) {
          return await client.command("pageAssets", args)
        },
      }),

      chrome_click: tool({
        description: "Click at viewport coordinates in a Chrome tab.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          x: tool.schema.number().describe("Viewport x coordinate."),
          y: tool.schema.number().describe("Viewport y coordinate."),
        },
        async execute(args, context) {
          await askChrome(context, "click", [`${args.x},${args.y}`])
          return await client.command("click", args)
        },
      }),

      chrome_type: tool({
        description: "Type text into the currently focused element in a Chrome tab.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          text: tool.schema.string().min(1).describe("Text to type."),
        },
        async execute(args, context) {
          await askChrome(context, "type", [args.text.slice(0, 80)])
          return await client.command("type", args)
        },
      }),

      chrome_keypress: tool({
        description: "Send a keyboard key to the current focused element in a Chrome tab.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          key: tool.schema.string().min(1).describe("Keyboard key value, such as Enter or Escape."),
        },
        async execute(args, context) {
          await askChrome(context, "keypress", [args.key])
          return await client.command("keypress", args)
        },
      }),

      chrome_scroll: tool({
        description: "Scroll the page or the scrollable element under a viewport point.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          deltaX: tool.schema.number().default(0).describe("Horizontal scroll delta."),
          deltaY: tool.schema.number().default(0).describe("Vertical scroll delta."),
          durationMs: tool.schema.number().int().min(0).max(3000).default(450).describe("Smooth scroll duration in milliseconds. Use 0 for instant scrolling."),
          x: tool.schema.number().optional().describe("Optional viewport x coordinate used to find a scrollable element."),
          y: tool.schema.number().optional().describe("Optional viewport y coordinate used to find a scrollable element."),
        },
        async execute(args, context) {
          await askChrome(context, "scroll", [`${args.deltaX},${args.deltaY}`])
          return await client.command("scroll", args)
        },
      }),

      chrome_evaluate: tool({
        description: "Run a read-only JavaScript expression in the selected or specified Chrome tab.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          script: tool.schema.string().min(1).max(10000).describe("Read-only JavaScript expression to evaluate."),
        },
        async execute(args, context) {
          assertReadonlyEvaluateScript(args.script)
          await askChrome(context, "evaluate read-only JavaScript", [args.script.slice(0, 120)])
          return await client.command("evaluate", args)
        },
      }),

      chrome_console_logs: tool({
        description: "Read console logs captured by the OpenCode Chrome content script.",
        args: {
          tabId: tool.schema.number().int().positive().optional().describe("Chrome tab id. Defaults to selected or active tab."),
          limit: tool.schema.number().int().min(1).max(200).default(50).describe("Maximum number of logs to return."),
        },
        async execute(args) {
          return await client.command("consoleLogs", args)
        },
      }),
    },
  }
}

export default ChromePlugin

class ChromeClient {
  constructor(private configPath?: string) {}

  async status() {
    try {
      const config = await this.config()
      const response = await fetch(`http://${config.host}:${config.port}/rpc`, {
        method: "POST",
        headers: this.headers(config),
        body: JSON.stringify({ id: randomUUID(), method: "status", params: {} }),
      })
      if (!response.ok) return `Native host responded with HTTP ${response.status}. Reload the Chrome extension and retry.`
      return JSON.stringify((await response.json()) as unknown, null, 2)
    } catch (error) {
      return `Chrome native host is not available: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  async command(method: BrowserMethod, params: unknown) {
    return JSON.stringify(await this.commandObject(method, params), null, 2)
  }

  async commandObject(method: BrowserMethod, params: unknown) {
    const config = await this.config()
    const response = await fetch(`http://${config.host}:${config.port}/rpc`, {
      method: "POST",
      headers: this.headers(config),
      body: JSON.stringify({ id: randomUUID(), method, params }),
    })
    const body = (await response.json()) as BrowserResponse
    if (!response.ok) throw new Error(body.error?.message ?? `Native host returned HTTP ${response.status}`)
    if (body.error) throw new Error(body.error.message)
    return body.result as Record<string, unknown>
  }

  private async config() {
    const file = this.configPath ?? runtimeConfigPath()
    return RuntimeConfigSchema.parse(JSON.parse(await readFile(file, "utf8")))
  }

  private headers(config: RuntimeConfig) {
    return {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
    }
  }
}

async function askChrome(context: ToolContext, action: string, patterns: string[]) {
  await context.ask({
    permission: `chrome.${action}`,
    patterns,
    always: [],
    metadata: { action },
  })
}

async function screenshotResult(dataUrl: string, title: unknown, url: unknown): Promise<ToolResult> {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl)
  if (!match) return jsonResult({ dataUrl, title, url })

  const directory = path.join(tmpdir(), "opencode-chrome-extension")
  const file = path.join(directory, `screenshot-${randomUUID()}.png`)
  await mkdir(directory, { recursive: true })
  await writeFile(file, Buffer.from(match[1], "base64"))

  return {
    title: typeof title === "string" ? title : "Chrome screenshot",
    output: JSON.stringify({ path: file, title, url }, null, 2),
    attachments: [
      {
        type: "file",
        mime: "image/png",
        url: pathToFileURL(file).href,
        filename: path.basename(file),
      },
    ],
  }
}

function jsonResult(value: unknown) {
  return JSON.stringify(value, null, 2)
}
