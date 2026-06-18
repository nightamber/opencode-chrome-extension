import { BrowserRequestSchema, BrowserResponseSchema, type BrowserRequest, type BrowserResponse } from "@opencode-chrome-extension/shared"
import { EventEmitter } from "node:events"

export class NativeTransport extends EventEmitter<{
  request: [BrowserRequest]
  response: [BrowserResponse]
  close: []
}> {
  private buffer = Buffer.alloc(0)

  constructor(
    private input: NodeJS.ReadStream,
    private output: NodeJS.WriteStream,
  ) {
    super()
  }

  start() {
    this.input.on("data", (chunk: Buffer) => this.read(chunk))
    this.input.on("end", () => this.emit("close"))
  }

  send(message: BrowserRequest | BrowserResponse) {
    const payload = Buffer.from(JSON.stringify(message), "utf8")
    const header = Buffer.alloc(4)
    header.writeUInt32LE(payload.length, 0)
    this.output.write(Buffer.concat([header, payload]))
  }

  private read(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const length = this.buffer.readUInt32LE(0)
      if (this.buffer.length < length + 4) return
      const payload = this.buffer.subarray(4, length + 4)
      this.buffer = this.buffer.subarray(length + 4)
      this.dispatch(payload)
    }
  }

  private dispatch(payload: Buffer) {
    const message = JSON.parse(payload.toString("utf8")) as unknown
    const response = BrowserResponseSchema.safeParse(message)
    if (response.success && (response.data.result !== undefined || response.data.error !== undefined)) {
      this.emit("response", response.data)
      return
    }
    this.emit("request", BrowserRequestSchema.parse(message))
  }
}
