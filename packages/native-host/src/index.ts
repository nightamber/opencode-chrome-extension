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
transport.start()
