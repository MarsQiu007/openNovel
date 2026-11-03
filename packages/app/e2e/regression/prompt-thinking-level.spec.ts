import { expect, test, type Page } from "@playwright/test"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"
import { expectAppVisible } from "../utils/waits"

const directory = "C:/OpenNovel/PromptThinkingLevelRegression"
const novelID = "novel_prompt_thinking_level"
const projectID = "proj_prompt_thinking_level_regression"
const sessionID = "ses_prompt_thinking_level_regression"

test("folds the thinking level into the model selection popover", async ({ page }) => {
  await mockOpenNovelServer(page, {
    directory,
    project: {
      id: projectID,
      worktree: directory,
      vcs: "git",
      name: "prompt-thinking-level-regression",
      time: { created: 1700000000000, updated: 1700000000000 },
      sandboxes: [],
    },
    provider: {
      all: [
        {
          id: "opennovel",
          name: "OpenNovel",
          models: {
            "thinking-model": {
              id: "thinking-model",
              name: "Thinking Model",
              limit: { context: 200_000 },
              variants: { high: {} },
            },
          },
        },
      ],
      connected: ["opennovel"],
      default: { providerID: "opennovel", modelID: "thinking-model" },
    },
    sessions: [
      {
        id: sessionID,
        slug: "prompt-thinking-level-regression",
        projectID,
        directory,
        title: "Prompt thinking level regression",
        version: "dev",
        time: { created: 1700000000000, updated: 1700000000000 },
      },
    ],
    pageMessages: () => ({ items: [] }),
  })
  await page.addInitScript(() => {
    localStorage.setItem("settings.v3", JSON.stringify({ general: { newLayoutDesigns: true } }))
    // 会话页嵌在书籍工作台右栏：拉宽对话面板以接近旧独立页的可用视区
    localStorage.setItem(
      "opennovel.global.dat:novel.workspace.layout.v1",
      JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
    )
  })

  await mockNovelWorkspaceAPIs(page, { directory, novelID, boundSessionIDs: [sessionID] })
  await page.goto(novelWorkspaceURL(directory, novelID, sessionID))
  const composer = page.locator('[data-component="prompt-input-v2"]')
  const input = composer.locator('[data-component="prompt-input"]')
  const model = composer.locator('[data-action="prompt-model"]')
  await expectAppVisible(composer)

  // 控件栏不再承载独立档位控件
  await idleComposer(page)
  await expect(model).toBeVisible()
  await expect(composer.getByRole("button", { name: "Choose model variant" })).toHaveCount(0)

  // 模型选择弹层内呈现推理档位分段，选中非默认档后芯片带"模型名 · 档位"后缀
  await model.click()
  const section = page.locator('[data-slot="model-variant-section"]')
  await expect(section).toBeVisible()
  await section.getByRole("button", { name: "high" }).click()
  await page.keyboard.press("Escape")

  await idleComposer(page)
  await input.focus()
  await expect(model).toContainText("Thinking Model · high")

  // 重开弹层：档位分段仍在且选中态保持
  await model.click()
  await expect(section).toBeVisible()
  await expect(section.getByRole("button", { name: "high" })).toBeVisible()
})

async function idleComposer(page: Page) {
  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}
