import { describe, expect, test } from "bun:test"
import { createT, dict, resolveLocale } from "./native-locale"

describe("resolveLocale", () => {
  const cases: Array<[unknown, string]> = [
    [undefined, "zh"],
    [null, "zh"],
    ["", "zh"],
    ["fr", "zh"],
    [42, "zh"],
    [["zh"], "zh"],
    [{ locale: "fr" }, "zh"],
    [{}, "zh"],
    ["zh", "zh"],
    ["en", "en"],
    ["zht", "zht"],
    ['"zh"', "zh"],
    ['{"locale":"en"}', "en"],
    [{ locale: "zht" }, "zht"],
  ]

  for (const [input, expected] of cases) {
    test(`parses ${JSON.stringify(input)} as ${expected}`, () => {
      expect(resolveLocale(() => input)).toBe(expected)
    })
  }
})

describe("dict", () => {
  test("三语词条一一对齐且无空文案", () => {
    for (const [key, entry] of Object.entries(dict)) {
      expect(Object.keys(entry).sort(), key).toEqual(["en", "zh", "zht"])
      for (const value of Object.values(entry)) {
        expect(value.length, key).toBeGreaterThan(0)
      }
    }
  })
})

describe("createT", () => {
  test("按当前语言渲染", () => {
    expect(createT(() => "zh")("updater.error.title")).toBe("更新错误")
    expect(createT(() => "en")("updater.error.title")).toBe("Update Error")
    expect(createT(() => '{"locale":"zht"}')("recovery.quit")).toBe("結束")
  })

  test("渲染并替换参数", () => {
    expect(createT(() => "zh")("updater.ready.message", { version: "0.1.5" })).toBe("更新 0.1.5 已下载。是否立即重启？")
  })

  test("未传参数时保留模板占位符", () => {
    expect(createT(() => "en")("updater.ready.message")).toBe("Update {version} downloaded. Restart now?")
  })

  test("语言解析失败时取词兜底简体中文", () => {
    expect(createT(() => "fr")("picker.file")).toBe("选择文件")
  })
})
