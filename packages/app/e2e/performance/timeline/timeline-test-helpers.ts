import type { Page } from "@playwright/test"
import { mockOpenNovelServer } from "../../utils/mock-server"
import { fixture } from "./session-timeline-stress.fixture"

export async function installTimelineSettings(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "settings.v3",
      JSON.stringify({
        general: {
          newLayoutDesigns: true,
          editToolPartsExpanded: true,
          shellToolPartsExpanded: true,
          showReasoningSummaries: true,
        },
      }),
    )
  })
}

// V2 化（perf-benchmark-v2）：分页由 V2 mock 服务端自持（不透明 cursor），fixture 只供升序全量。
export function mockStressTimeline(page: Page, input?: { vcsDiff?: unknown[] }) {
  return mockOpenNovelServer(page, {
    sessions: fixture.sessions,
    provider: fixture.provider,
    directory: fixture.directory,
    project: fixture.project,
    v2Messages: (sessionID) => fixture.messages[sessionID as keyof typeof fixture.messages] ?? [],
    vcsDiff: input?.vcsDiff,
  })
}

/** 注入会话链接供基准点击打开：书内基准以锚点点击替代已退役的标签入口（套件既定的诊断手法）。 */
export async function injectSessionLink(page: Page, input: { id: string; href: string; text?: string }) {
  await page.evaluate(({ id, href, text }) => {
    const link = document.createElement("a")
    link.id = id
    link.href = href
    // 无文本的锚点尺寸为零不可点击；默认给可见文本，保证真实点击可用
    link.textContent = text ?? "open"
    document.body.append(link)
  }, input)
}

export function createReviewDiffs() {
  return Array.from({ length: Number(process.env.REVIEW_PANE_DIFF_COUNT ?? 72) }, (_, index) => {
    const lines = index % 3 === 0 ? 300 : index % 3 === 1 ? 120 : 38
    const file = `src/review/generated-${String(index).padStart(3, "0")}.ts`
    const before = reviewSource(index, lines)
    const after = before
      .replace(`value_${index}_4`, `updated_${index}_4`)
      .replace(
        `value_${index}_${Math.max(8, Math.floor(lines / 2))}`,
        `updated_${index}_${Math.max(8, Math.floor(lines / 2))}`,
      )
      .replace(`value_${index}_${lines - 4}`, `updated_${index}_${lines - 4}`)
    return {
      file,
      patch: reviewPatch(file, before, after),
      additions: 3,
      deletions: 3,
      status: "modified" as const,
    }
  })
}

function reviewSource(seed: number, lines: number) {
  return Array.from(
    { length: lines },
    (_, index) => `export const value_${seed}_${index} = "${reviewWords(seed + index, index % 5 === 0 ? 180 : 42)}"`,
  ).join("\n")
}

function reviewPatch(file: string, before: string, after: string) {
  const beforeLines = before.split("\n")
  const afterLines = after.split("\n")
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.flatMap((line, index) => {
      const next = afterLines[index]!
      if (line === next) return [` ${line}`]
      return [`-${line}`, `+${next}`]
    }),
  ].join("\n")
}

function reviewWords(seed: number, length: number) {
  const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet"]
  return Array.from({ length: Math.ceil(length / 7) }, (_, index) => words[(seed + index * 3) % words.length]).join(" ")
}
