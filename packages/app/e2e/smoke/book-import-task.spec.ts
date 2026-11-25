/**
 * 原文驱动导入任务页三态冒烟（source-driven-import）：
 * 配置态启动后跳转到 /:dir/novel/:novelID/import；处理态展示真实进度、已产出章节、
 * 修复统计与暂停/恢复/重试控制；暂停中「应用到未开始部分」只触发未开始尾部重规划；
 * 完成态展示统一报告与打开书籍入口。新固定文案为中文直写，断言不受 e2e en locale 影响。
 */
import { expect, test } from "@playwright/test"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import { mockOpenNovelServer } from "../utils/mock-server"
import { mockNovelWorkspaceAPIs, novelWorkspaceURL } from "../utils/novel-workspace"

const directory = "D:\\OpenNovelE2E\\import-task"
const NOVEL_ID = "novel_e2e_import_task"
const JOB_ID = "job_e2e_import_task"

function progress(status: string, overrides: Record<string, unknown> = {}) {
  return {
    novelId: NOVEL_ID,
    jobId: JOB_ID,
    sessionId: null,
    status,
    phase: status === "completed" ? "done" : status === "paused" ? "calibration" : "calibration",
    processedChars: status === "completed" ? 120 : 60,
    totalChars: 120,
    progressRatio: status === "completed" ? 1 : 0.5,
    chapterCount: status === "awaiting_queue" ? 0 : 1,
    calibrationReached: false,
    sourceExhausted: status === "completed",
    planVersion: 0,
    carryCount: 0,
    chapters:
      status === "awaiting_queue"
        ? []
        : [
            {
              chapterId: "ch_e2e_1",
              order: 1,
              title: "第1章 风起",
              wordCount: 60,
              settingsStage: status === "completed" ? "done" : "pending",
              techniqueStage: status === "completed" ? "done" : "pending",
            },
          ],
    ...overrides,
  }
}

const importReport = {
  novelId: NOVEL_ID,
  title: "斗破苍穹",
  chapterCount: 1,
  planVersion: 0,
  opCounts: { keep: 1, exclude: 1 },
  excluded: [{ chapterId: "ch_e2e_1", reason: "广告", beforeText: "www.example.com" }],
  moveCount: 0,
  unresolvedCount: 0,
}

test("导入任务页三态：处理进度、暂停配置、完成报告", async ({ page }) => {
  let currentStatus = "calibrating"
  const controls: string[] = []
  await mockOpenNovelServer(page, {
    directory,
    sessions: [],
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
  })
  await mockNovelWorkspaceAPIs(page, { directory, novelID: NOVEL_ID })
  // 导入端点：启动返回任务标识，进度按当前状态翻转，报告聚合修复与排除
  await page.route(/\/api\/novel\/import\/start(\?|$)/, async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(progress(currentStatus)) }),
  )
  await page.route(new RegExp(`/api/novel/${NOVEL_ID}/import/report(\\?|$)`), async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(importReport) }),
  )
  await page.route(new RegExp(`/api/novel/${NOVEL_ID}/import/control(\\?|$)`), async (route) => {
    const body = route.request().postDataJSON() as { action?: string }
    controls.push(body.action ?? "")
    if (body.action === "pause") currentStatus = "paused"
    if (body.action === "resume") currentStatus = "completed"
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(progress(currentStatus)) })
  })
  await page.route(new RegExp(`/api/novel/${NOVEL_ID}/import(\\?|$)`), async (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(progress(currentStatus)) }),
  )
  await page.addInitScript((dir) => {
    localStorage.setItem(
      "opennovel.global.dat:server",
      JSON.stringify({
        projects: { local: [{ worktree: dir, expanded: true }] },
        lastProject: { local: dir },
      }),
    )
  }, directory)

  await page.goto(`/${base64Encode(directory)}/novel/import`)
  await page.setInputFiles('input[type="file"]', {
    name: "斗破苍穹.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("第1章 风起\n\n正文。\n\n第2章 云涌\n\n正文。"),
  })
  await page.getByRole("button", { name: "开始导入" }).click()

  // 处理态：真实进度、已产出章节、修复统计与暂停控制
  await expect(page.getByText("结构校准")).toBeVisible()
  await expect(page.getByText("已产出 1 章")).toBeVisible()
  await page.getByRole("button", { name: "暂停" }).click()
  await expect(page.getByText("已暂停")).toBeVisible()

  // 暂停中「应用到未开始部分」：配置面板应用后仍保持暂停（不隐式唤醒）
  await page.getByRole("button", { name: "应用到未开始部分" }).click()
  await page.getByRole("button", { name: "应用配置" }).click()
  await expect(page.getByText("已暂停")).toBeVisible()

  // 恢复后完成：统一报告与打开书籍
  await page.getByRole("button", { name: "恢复" }).click()
  await expect(page.getByText("已完成")).toBeVisible()
  await expect(page.getByText("已排除内容")).toBeVisible()
  await expect(page.getByRole("button", { name: /Open book|打开书籍/ })).toBeVisible()

  expect(controls).toEqual(["pause", "configure", "resume"])
  await page.goto(novelWorkspaceURL(directory, NOVEL_ID))
})

