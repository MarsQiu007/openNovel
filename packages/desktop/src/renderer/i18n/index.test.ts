import { describe, expect, test } from "bun:test"
import { detectLocale } from "./index"

function withLanguages(languages: string[] | undefined, run: () => void) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "navigator")
  Object.defineProperty(globalThis, "navigator", {
    value: languages === undefined ? undefined : { languages },
    configurable: true,
    writable: true,
  })
  try {
    run()
  } finally {
    if (original) Object.defineProperty(globalThis, "navigator", original)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
}

describe("detectLocale", () => {
  test("探测不到时兜底简体中文", () => {
    withLanguages(undefined, () => expect(detectLocale()).toBe("zh"))
    withLanguages([], () => expect(detectLocale()).toBe("zh"))
    withLanguages(["fr-FR"], () => expect(detectLocale()).toBe("zh"))
  })

  test("识别英文与中文系系统语言", () => {
    withLanguages(["en-US"], () => expect(detectLocale()).toBe("en"))
    withLanguages(["zh-CN"], () => expect(detectLocale()).toBe("zh"))
    withLanguages(["zh-Hant-TW"], () => expect(detectLocale()).toBe("zht"))
  })
})
