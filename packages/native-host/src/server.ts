import {
  BrowserRequestSchema,
  RuntimeConfigSchema,
  runtimeConfigPath,
  type BrowserRequest,
  type BrowserResponse,
  type RuntimeConfig,
} from "@opencode-chrome-extension/shared"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type { NativeTransport } from "./native"

export type BridgeState = {
  connected: boolean
  pending: Map<string, (response: BrowserResponse) => void>
  transport?: NativeTransport
}

export function createBridgeState(): BridgeState {
  return {
    connected: false,
    pending: new Map(),
  }
}

export function attachTransport(state: BridgeState, transport: NativeTransport) {
  state.transport = transport
  state.connected = true
  transport.on("response", (response) => {
    state.pending.get(response.id)?.(response)
    state.pending.delete(response.id)
  })
  transport.on("close", () => {
    state.connected = false
    state.transport = undefined
  })
}

export async function forwardToExtension(state: BridgeState, request: BrowserRequest, timeoutMs = 30000) {
  if (!state.transport || !state.connected) {
    throw new Error("Chrome extension is not connected to the native host")
  }

  return await new Promise<BrowserResponse>((resolve, reject) => {
    const timeout = setTimeout(() => {
      state.pending.delete(request.id)
      reject(new Error(`Timed out waiting for Chrome response to ${request.method}`))
    }, timeoutMs)

    state.pending.set(request.id, (response) => {
      clearTimeout(timeout)
      resolve(response)
    })

    state.transport?.send(request)
  })
}

export function createRuntimeToken() {
  return randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "")
}

export async function writeRuntimeConfig(port: number, token: string, home = process.env.HOME ?? "") {
  const config: RuntimeConfig = RuntimeConfigSchema.parse({
    host: "127.0.0.1",
    port,
    token,
    updatedAt: new Date().toISOString(),
  })
  const file = runtimeConfigPath(home)
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, "utf8")
  return config
}

export function createHttpHandler(state: BridgeState, token: string) {
  return async (request: Request) => {
    const url = new URL(request.url)

    if (request.method === "GET" && url.pathname === "/status") {
      return Response.json({ connected: state.connected })
    }

    if (request.method !== "POST" || url.pathname !== "/rpc") {
      return Response.json({ error: "not_found" }, { status: 404 })
    }

    if (request.headers.get("authorization") !== `Bearer ${token}`) {
      return Response.json({ error: "unauthorized" }, { status: 401 })
    }

    const parsed = BrowserRequestSchema.safeParse(await request.json())
    if (!parsed.success) {
      return Response.json({ error: "invalid_request", issues: parsed.error.issues }, { status: 400 })
    }

    if (parsed.data.method === "status") {
      return Response.json({
        id: parsed.data.id,
        result: { nativeHost: true, extensionConnected: state.connected },
      })
    }

    try {
      const response = await forwardToExtension(state, parsed.data)
      return Response.json(response)
    } catch (error) {
      return Response.json(
        {
          id: parsed.data.id,
          error: {
            code: "extension_unavailable",
            message: error instanceof Error ? error.message : String(error),
          },
        },
        { status: 503 },
      )
    }
  }
}
