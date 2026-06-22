import { createBridgeState, attachTransport, createHttpHandler, createRuntimeToken, writeRuntimeConfig } from "./server"
import { NativeTransport } from "./native"

const state = createBridgeState()
const token = createRuntimeToken()
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: createHttpHandler(state, token),
})
if (!server.port) throw new Error("Unable to allocate local native host port")
await writeRuntimeConfig(server.port, token)

const transport = new NativeTransport(process.stdin, process.stdout)
attachTransport(state, transport)
transport.on("request", (request) => {
  if (request.method === "status") {
    transport.send({
      id: request.id,
      result: {
        extensionConnected: state.connected,
        host: "127.0.0.1",
        nativeHost: true,
        port: server.port,
      },
    })
    return
  }

  transport.send({
    id: request.id,
    error: {
      code: "unsupported_native_request",
      message: `Native host does not accept extension request ${request.method}`,
    },
  })
})
transport.start()
