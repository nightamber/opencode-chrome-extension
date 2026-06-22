import { mkdir, cp, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { deflateSync } from "node:zlib"

const root = path.resolve(import.meta.dir, "..")
const outdir = path.join(root, "dist/extension")

await rm(outdir, { force: true, recursive: true })
await mkdir(outdir, { recursive: true })
await Bun.build({
  entrypoints: [path.join(root, "src/background.ts"), path.join(root, "src/content.ts"), path.join(root, "src/popup.ts")],
  format: "esm",
  minify: false,
  outdir,
  sourcemap: "external",
  target: "browser",
})
await cp(path.join(root, "public"), outdir, { recursive: true })
await writeActionIcons(path.join(outdir, "icons"))
console.log(`Built Chrome extension into ${outdir}`)

async function writeActionIcons(dir: string) {
  await mkdir(dir, { recursive: true })
  for (const size of [16, 32, 48, 128]) {
    await writeFile(path.join(dir, `idle-${size}.png`), pngIcon(size, [107, 114, 128, 255]))
    await writeFile(path.join(dir, `busy-${size}.png`), pngIcon(size, [220, 38, 38, 255]))
  }
}

function pngIcon(size: number, background: [number, number, number, number]) {
  const pixels = Buffer.alloc(size * size * 4)
  const center = (size - 1) / 2
  const outer = size * 0.27
  const inner = size * 0.14
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = (y * size + x) * 4
      pixels[offset] = background[0]
      pixels[offset + 1] = background[1]
      pixels[offset + 2] = background[2]
      pixels[offset + 3] = background[3]

      const distance = Math.hypot(x - center, y - center)
      if (distance <= outer && distance >= inner) {
        pixels[offset] = 255
        pixels[offset + 1] = 255
        pixels[offset + 2] = 255
        pixels[offset + 3] = 255
      }
    }
  }

  const scanlines = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1)
    scanlines[row] = 0
    pixels.copy(scanlines, row + 1, y * size * 4, (y + 1) * size * 4)
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr(size)),
    pngChunk("IDAT", deflateSync(scanlines)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function ihdr(size: number) {
  const buffer = Buffer.alloc(13)
  buffer.writeUInt32BE(size, 0)
  buffer.writeUInt32BE(size, 4)
  buffer[8] = 8
  buffer[9] = 6
  buffer[10] = 0
  buffer[11] = 0
  buffer[12] = 0
  return buffer
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])), 0)
  return Buffer.concat([length, name, data, checksum])
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let i = 0; i < 8; i++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
