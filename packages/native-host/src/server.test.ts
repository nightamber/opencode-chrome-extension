import { describe, expect, test } from "bun:test"
import { createBridgeState, createHttpHandler } from "./server"

describe("http bridge", () => {
  test("rejects missing token", async () => {
    const response = await createHttpHandler(createBridgeState(), "secret")(
      new Request("http://127.0.0.1/rpc", {
        method: "POST",
        body: JSON.stringify({ id: "1", method: "status" }),
      }),
    )
    expect(response.status).toBe(401)
  })

  test("answers status locally", async () => {
    const response = await createHttpHandler(createBridgeState(), "secret")(
      new Request("http://127.0.0.1/rpc", {
        method: "POST",
        headers: { authorization: "Bearer secret" },
        body: JSON.stringify({ id: "1", method: "status" }),
      }),
    )
    expect(await response.json()).toEqual({
      id: "1",
      result: { nativeHost: true, extensionConnected: false },
    })
  })
})
