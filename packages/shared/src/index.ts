import { z } from "zod"

export const NativeHostName = "com.opencode.chrome_extension"
export const RuntimeDirectoryName = ".opencode-chrome-extension"
export const RuntimeFileName = "runtime.json"

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
)

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export const TabSchema = z.object({
  active: z.boolean().optional(),
  id: z.number(),
  title: z.string().optional(),
  url: z.string().optional(),
  windowId: z.number().optional(),
})

export const DomNodeSchema = z.object({
  id: z.string(),
  tag: z.string(),
  text: z.string().optional(),
  ariaLabel: z.string().optional(),
  role: z.string().optional(),
  href: z.string().optional(),
  value: z.string().optional(),
  checked: z.boolean().optional(),
  disabled: z.boolean().optional(),
  rect: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
  }),
})

export const ConsoleLogSchema = z.object({
  level: z.enum(["debug", "info", "log", "warn", "error"]),
  message: z.string(),
  timestamp: z.number(),
})

const EmptySchema = z.object({}).optional()

export const BrowserMethodSchemas = {
  status: EmptySchema,
  tabsList: EmptySchema,
  tabSelect: z.object({ tabId: z.number().int().positive() }),
  tabNew: z.object({ url: z.string().url().optional() }),
  tabGoto: z.object({ tabId: z.number().int().positive().optional(), url: z.string().url() }),
  tabScreenshot: z.object({ tabId: z.number().int().positive().optional() }),
  domSnapshot: z.object({ tabId: z.number().int().positive().optional() }),
  click: z.object({ tabId: z.number().int().positive().optional(), x: z.number(), y: z.number() }),
  type: z.object({ tabId: z.number().int().positive().optional(), text: z.string().min(1) }),
  keypress: z.object({ tabId: z.number().int().positive().optional(), key: z.string().min(1) }),
  scroll: z.object({
    tabId: z.number().int().positive().optional(),
    deltaX: z.number().default(0),
    deltaY: z.number().default(0),
    x: z.number().optional(),
    y: z.number().optional(),
  }),
  evaluate: z.object({ tabId: z.number().int().positive().optional(), script: z.string().min(1).max(10000) }),
  consoleLogs: z.object({ tabId: z.number().int().positive().optional(), limit: z.number().int().min(1).max(200).default(50) }),
} as const

export type BrowserMethod = keyof typeof BrowserMethodSchemas

export const BrowserRequestSchema = z.object({
  id: z.string().min(1),
  method: z.enum(Object.keys(BrowserMethodSchemas) as [BrowserMethod, ...BrowserMethod[]]),
  params: z.unknown().optional(),
})

export const BrowserResponseSchema = z.object({
  id: z.string().min(1),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
    })
    .optional(),
})

export const RuntimeConfigSchema = z.object({
  host: z.literal("127.0.0.1"),
  port: z.number().int().min(1).max(65535),
  token: z.string().min(24),
  updatedAt: z.string(),
})

export type BrowserRequest = z.infer<typeof BrowserRequestSchema>
export type BrowserResponse = z.infer<typeof BrowserResponseSchema>
export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>
export type TabInfo = z.infer<typeof TabSchema>
export type DomNodeInfo = z.infer<typeof DomNodeSchema>
export type ConsoleLogInfo = z.infer<typeof ConsoleLogSchema>
export type BrowserParams<M extends BrowserMethod> = z.infer<(typeof BrowserMethodSchemas)[M]>

export function parseBrowserParams<M extends BrowserMethod>(method: M, params: unknown): BrowserParams<M> {
  return BrowserMethodSchemas[method].parse(params) as BrowserParams<M>
}

const UnsafeEvaluatePatterns = [
  /\bfetch\s*\(/i,
  /\bXMLHttpRequest\b/i,
  /\bnavigator\.sendBeacon\b/i,
  /\blocation\s*=/i,
  /\blocation\.(assign|replace|reload)\s*\(/i,
  /\bhistory\.(pushState|replaceState|go|back|forward)\s*\(/i,
  /\bdocument\.cookie\s*=/i,
  /\b(localStorage|sessionStorage)\.setItem\s*\(/i,
  /\b(localStorage|sessionStorage)\.removeItem\s*\(/i,
  /\b(localStorage|sessionStorage)\.clear\s*\(/i,
  /\b(indexedDB|caches)\b/i,
  /\.(append|appendChild|prepend|remove|replaceChildren|replaceWith|insertAdjacentHTML|insertAdjacentElement)\s*\(/i,
  /\.(setAttribute|removeAttribute|toggleAttribute)\s*\(/i,
  /\.(click|submit|focus|blur)\s*\(/i,
  /\b(eval|Function)\s*\(/i,
  /\bimport\s*\(/i,
]

export function assertReadonlyEvaluateScript(script: string) {
  const match = UnsafeEvaluatePatterns.find((pattern) => pattern.test(script))
  if (!match) return
  throw new Error(`chrome_evaluate only allows read-only scripts; blocked pattern ${match.source}`)
}

export function runtimeConfigPath(home = process.env.HOME ?? "") {
  if (!home) throw new Error("Unable to resolve HOME for runtime config")
  return `${home}/${RuntimeDirectoryName}/${RuntimeFileName}`
}
