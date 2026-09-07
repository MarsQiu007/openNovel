import { describe, expect, test } from "bun:test"
import { buildBootstrapPrompt, shouldShowBootstrapSuggestion } from "./book-bootstrap"

describe("book bootstrap", () => {
  test("shows the suggestion only after setting queries load and both counts are zero", () => {
    expect(
      shouldShowBootstrapSuggestion({
        charactersLoaded: true,
        worldEntriesLoaded: true,
        characterCount: 0,
        worldEntryCount: 0,
      }),
    ).toBe(true)

    expect(
      shouldShowBootstrapSuggestion({
        charactersLoaded: false,
        worldEntriesLoaded: true,
        characterCount: 0,
        worldEntryCount: 0,
      }),
    ).toBe(false)

    expect(
      shouldShowBootstrapSuggestion({
        charactersLoaded: true,
        worldEntriesLoaded: true,
        characterCount: 1,
        worldEntryCount: 0,
      }),
    ).toBe(false)
  })

  test("builds a specific initialization prompt with book context", () => {
    const prompt = buildBootstrapPrompt({
      title: "星海拾遗",
      genre: "科幻",
      synopsis: "年轻档案员在废弃空间站里发现了一段会自我修改的航行记录。",
    })

    expect(prompt).toContain("初始化小说设定")
    expect(prompt).toContain("书名：星海拾遗")
    expect(prompt).toContain("类型：科幻")
    expect(prompt).toContain("废弃空间站")
  })
})
