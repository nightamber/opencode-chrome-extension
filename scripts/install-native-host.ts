import { NativeHostName } from "../packages/shared/src/index"
import { mkdir, writeFile } from "node:fs/promises"
import { chmodSync, existsSync, readFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir, platform } from "node:os"
import path from "node:path"

const dryRun = process.argv.includes("--dry-run")
const root = path.resolve(import.meta.dir, "..")
const hostBundle = path.join(root, "packages/native-host/dist/native-host.mjs")
const launcher = path.join(root, "packages/native-host/dist/native-host")
const extensionDist = path.join(root, "packages/extension/dist/extension")
const bunPath = process.execPath

if (platform() !== "darwin") {
  throw new Error("install-native-host currently supports macOS only")
}

if (!existsSync(hostBundle)) {
  throw new Error("Missing packages/native-host/dist/native-host.mjs. Run `bun run build:host` first.")
}

const manifestPath = path.join(
  homedir(),
  "Library/Application Support/Google/Chrome/NativeMessagingHosts",
  `${NativeHostName}.json`,
)
const manifest = {
  name: NativeHostName,
  description: "OpenCode Chrome Native Messaging host",
  path: launcher,
  type: "stdio",
  allowed_origins: [`chrome-extension://${readExtensionId()}/`],
}
const launcherContents = `#!/bin/sh
exec "${bunPath}" "${hostBundle}" "$@"
`

if (dryRun) {
  console.log(JSON.stringify({ manifestPath, manifest, launcher, launcherContents }, null, 2))
  process.exit(0)
}

await mkdir(path.dirname(launcher), { recursive: true })
await writeFile(launcher, launcherContents, "utf8")
chmodSync(launcher, 0o755)
await mkdir(path.dirname(manifestPath), { recursive: true })
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
console.log(`Installed ${NativeHostName} native host manifest at ${manifestPath}`)

function readExtensionId() {
  const manifestFile = path.join(extensionDist, "manifest.json")
  if (!existsSync(manifestFile)) {
    throw new Error("Missing packages/extension/dist/extension/manifest.json. Run `bun run build:extension` first.")
  }
  const manifestData = JSON.parse(readFileSync(manifestFile, "utf8")) as { key?: string }
  if (!manifestData.key) {
    throw new Error("Extension manifest must include a stable key so allowed_origins can be installed deterministically.")
  }
  return chromeExtensionIdFromKey(manifestData.key)
}

function chromeExtensionIdFromKey(publicKeyBase64: string) {
  const key = Buffer.from(publicKeyBase64, "base64")
  return Array.from(createHash("sha256").update(key).digest().subarray(0, 16))
    .map((byte) => String.fromCharCode("a".charCodeAt(0) + (byte >> 4)) + String.fromCharCode("a".charCodeAt(0) + (byte & 0x0f)))
    .join("")
}
