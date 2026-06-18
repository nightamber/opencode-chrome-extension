import { mkdir, cp, rm } from "node:fs/promises"
import path from "node:path"

const root = path.resolve(import.meta.dir, "..")
const outdir = path.join(root, "dist/extension")

await rm(outdir, { force: true, recursive: true })
await mkdir(outdir, { recursive: true })
await Bun.build({
  entrypoints: [path.join(root, "src/background.ts"), path.join(root, "src/content.ts")],
  format: "esm",
  minify: false,
  outdir,
  sourcemap: "external",
  target: "browser",
})
await cp(path.join(root, "public"), outdir, { recursive: true })
console.log(`Built Chrome extension into ${outdir}`)
