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

  // 模型选择弹层内档位分段收纳：收纳行常驻显示标签与当前值，点击后行内展开档位列表
  await model.click()
  const section = page.locator('[data-slot="model-variant-section"]')
  await expect(section).toBeVisible()
  const toggle = section.locator('[data-slot="model-variant-toggle"]')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toggle).toContainText("Default")
  // 收起态：无档位选项（toggle 名含标签文案，精确匹配避免误中）
  await expect(section.getByRole("button", { name: "high", exact: true })).toHaveCount(0)

  // 展开后选中非默认档：列表收回且弹层保持打开（免费弹层现状），收纳行显示当前档位值
  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  const option = section.getByRole("button", { name: "high", exact: true })
  await expect(option).toBeVisible()
  await option.click()

  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toggle).toContainText("high")
  await expect(section.getByRole("button", { name: "high", exact: true })).toHaveCount(0)

  await page.keyboard.press("Escape")
  await idleComposer(page)
  await input.focus()
  await expect(model).toContainText("Thinking Model · high")

  // 重开弹层：收纳行显示当前档位值且回到收起态
  await model.click()
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toggle).toContainText("high")
  await expect(section.getByRole("button", { name: "high", exact: true })).toHaveCount(0)
})

test("keeps the reasoning section visible with a default-only item for models without variants", async ({ page }) => {
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
            "plain-model": {
              id: "plain-model",
              name: "Plain Model",
              limit: { context: 200_000 },
            },
          },
        },
      ],
      connected: ["opennovel"],
      default: { providerID: "opennovel", modelID: "plain-model" },
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
  const model = composer.locator('[data-action="prompt-model"]')
  await expectAppVisible(composer)

  // 无档位模型：收纳行常驻显示 default；展开后分段内仅含 default 弱化单项与弱提示文案
  await idleComposer(page)
  await model.click()
  const section = page.locator('[data-slot="model-variant-section"]')
  await expect(section).toBeVisible()
  const toggle = section.locator('[data-slot="model-variant-toggle"]')
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute("aria-expanded", "false")
  await expect(toggle).toContainText("Default")

  await toggle.click()
  await expect(toggle).toHaveAttribute("aria-expanded", "true")
  await expect(section).toContainText("Default")
  await expect(section).toContainText("No reasoning levels for this model")
  // 空态不提供任何可选档位项（分段内仅剩收纳行一个按钮）
  await expect(section.getByRole("button")).toHaveCount(1)

  // 芯片无档位后缀
  await page.keyboard.press("Escape")
  await idleComposer(page)
  await expect(model).toContainText("Plain Model")
  await expect(model).not.toContainText("·")
})

async function idleComposer(page: Page) {
  await page.mouse.move(0, 0)
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
}
