import { describe, expect, test } from "bun:test"
import { assertReadonlyEvaluateScript, parseBrowserParams } from "./index"

describe("protocol validation", () => {
  test("parses method params", () => {
    expect(parseBrowserParams("tabGoto", { url: "https://example.com" })).toEqual({
      url: "https://example.com",
    })
  })

  test("rejects invalid urls", () => {
    expect(() => parseBrowserParams("tabGoto", { url: "not a url" })).toThrow()
  })
})

describe("readonly evaluate guard", () => {
  test("allows read-only expressions", () => {
    expect(() => assertReadonlyEvaluateScript("document.title")).not.toThrow()
  })

  test("blocks navigation and mutation", () => {
    expect(() => assertReadonlyEvaluateScript("location.assign('https://example.com')")).toThrow()
    expect(() => assertReadonlyEvaluateScript("document.body.appendChild(document.createElement('div'))")).toThrow()
  })
})
