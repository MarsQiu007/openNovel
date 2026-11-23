import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"

// 书籍导入「AI 整理」冒烟（book-import-pipeline）：
// 报告页点击后向绑定会话发出建队形态指令（断言含导入整理路由关键词），
// 会话页队列区块经 mock 注入呈现导入整理队列。

const directory = "D:\\OpenNovelE2E\\import-tidy"
const NOVEL_ID = "novel_e2e_import"
const SESSION_ID = "ses_e2e_import"
const GOAL = "导入整理《斗破苍穹》：分章校验、逐章纠错/设定/技法、简介与汇总"

const cleanSummary = {
  whitespaceTrimmed: 0,
  blankLinesCollapsed: 0,
  punctuationNormalized: 0,
  linesMerged: 0,
  adsRemoved: 0,
  duplicatesRemoved: 0,
}
const importPreview = {
  suggestedTitle: "斗破苍穹",
  encoding: "utf-8",
  volumes: [
    {
      title: null,
      chapters: [
        { title: "第1章 风起", wordCount: 2100 },
        { title: "第2章 云涌", wordCount: 1900 },
      ],
    },
  ],
  issues: [],
  cleanSummary,
  previewToken: "tok_e2e",
}
const importReport = {
  novelId: NOVEL_ID,
  title: "斗破苍穹",
  volumeCount: 1,
  chapterCount: 2,
  cleanSummary,
  issues: [],
}
const workRun = {
  id: "wr_e2e",
  sessionID: SESSION_ID,
  goal: GOAL,
  status: "active",
  progressNote: "第 1 章：纠错✓ 设定进行中",
  continuationCount: 0,
  noProgressCount: 0,
  timeCreated: "2026-11-23T00:00:00.000Z",
  timeUpdated: "2026-11-23T00:00:00.000Z",
  items: [
    { seq: 1, title: "分章结构校验", status: "done", note: "无异常" },
    { seq: 2, title: "第 1 章 风起 · 章节整理", status: "in_progress", note: "纠错✓ 设定进行中" },
  ],
}

test("导入报告「AI 整理」发建队指令并呈现导入整理队列", async ({ page }) => {
  const prompts: { sessionID: string; text: string }[] = []
  await mockOpenNovelServer(page, {
    directory,
    sessions: [{ id: SESSION_ID }],
    provider: {
      all: [
        {
          id: "opennovel",
          name: "OpenNovel",
          models: { "claude-opus-4-6": { id: "claude-opus-4-6", name: "Claude Opus 4.6", limit: { context: 200_000 } } },
        },
      ],
      connected: ["opennovel"],
      default: { providerID: "opennovel", modelID: "claude-opus-4-6" },
    },
    project: { id: "proj_e2e", name: "E2E", directory },
    v2WorkRun: () => workRun,
  })
  await mockNovelWorkspaceAPIs(page, {
    directory,
    novelID: NOVEL_ID,
    boundSessionIDs: [SESSION_ID],
    onSessionPrompt: ({ sessionID, body }) => {
      prompts.push({ sessionID, text: body.prompt?.text ?? "" })
    },
  })
  // 导入端点（mock-server 未登记，按 generated client 路径原样模拟；
  // 路由正则需容忍 location 查询串——整体 URL 匹配，"$" 会漏掉 "?..."）
  await page.route(/\/api\/novel\/import\/analyze(\?|$)/, async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(importPreview) }),
  )
  await page.route(/\/api\/novel\/import\/apply(\?|$)/, async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(importReport) }),
  )
  // 兜底：若绑定解析失败走懒创建（POST /api/session 由 mock-server 登记），bind 不至于落入空列表
  await page.route(/\/api\/novel\/[^/]+\/bind(\?|$)/, async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "{}" }),
  )
  // 与 session-timeline smoke 同款的启动面：项目登记 + 拉宽对话面板
  await page.addInitScript((dir) => {
    localStorage.setItem(
      "opennovel.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: dir, expanded: true }] },
        lastProject: { local: dir },
      }),
    )
    localStorage.setItem(
      "opennovel.global.dat:novel.workspace.layout.v1",
      JSON.stringify({ railPanel: "chat", railWidth: 1100 }),
    )
  }, directory)

  await page.goto(`/${base64Encode(directory)}/novel/import`)
  await page.setInputFiles('input[type="file"]', {
    name: "斗破苍穹.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("第1章 风起\n\n正文。\n\n第2章 云涌\n\n正文。"),
  })
  // e2e 默认 en locale：界面断言用英文文案，指令内容断言仍是中文（客户端固定中文拼装）
  await page.getByRole("button", { name: "Analyze" }).click()
  await expect(page.getByRole("button", { name: "Confirm Import" })).toBeVisible()
  await page.getByRole("button", { name: "Confirm Import" }).click()
  const tidyButton = page.getByRole("button", { name: "Tidy with AI" })
  await expect(tidyButton).toBeVisible()
  await tidyButton.click()

  // 建队形态指令：已绑定会话存在，直发 prompt；文本含导入整理路由关键词
  await expect.poll(() => prompts.length).toBeGreaterThan(0)
  expect(prompts[0]?.sessionID).toBe(SESSION_ID)
  const sent = prompts[0]
  expect(sent.text).toContain("导入后整理")
  expect(sent.text).toContain("工作队列")
  expect(sent.text).toContain("分章结构校验")
  expect(sent.text).toContain("单读三产出")
  await expect(page.getByText("Tidy instruction sent")).toBeVisible()

  // 会话页队列区块呈现导入整理队列（mock 注入 + 首拉）
  await page.goto(novelWorkspaceURL(directory, NOVEL_ID, SESSION_ID))
  await expect(page.locator('[data-slot="session-workrun-goal"]')).toContainText("导入整理《斗破苍穹》")
  await expect(page.locator('[data-slot="session-workrun-status"]')).toContainText("In progress")
})
