/**
 * 书籍导入任务页（原文驱动导入）：同一任务的三种状态。
 * 处理态：真实原文比例、校准/计划阶段、当前阅读范围、已产出章节、
 * 修复统计、暂停/恢复/重试与「应用到未开始部分」配置；校准前不显示精确总章数。
 * 完成态：统一报告（章节、修复记录、排除内容与未解决项）+ 打开书籍。
 * 页面以 novelID/jobID 为稳定键，轮询持久化任务，离开重进自动恢复。
 * 新固定文案用简体中文直写：locale 冻结（AGENTS.md），既有 key 继续走 language.t。
 */
import { createMemo, createSignal, For, Show } from "solid-js"
import { useNavigate, useParams } from "@solidjs/router"
import { useLanguage } from "@/context/language"
import { useNovel } from "@/context/novel"
import { useSDK } from "@/context/sdk"
import { useImportControl, useImportProgress, useImportReport } from "@/context/novel-queries"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opennovel-ai/core/util/encode"
import type { NovelImportRepairLevel } from "@opennovel-ai/schema/novel"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { FieldV2 } from "@opennovel-ai/ui/v2/field-v2"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
function parseRepairLevel(value: string): NovelImportRepairLevel {
  return value === "aggressive" || value === "off" ? value : "standard"
}
function isImportNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false
  const data = (err as { data?: unknown }).data
  if (typeof data !== "object" || data === null) return false
  return (data as { reason?: unknown }).reason === "not-found"
}

const OP_LABELS: Record<string, string> = {
  keep: "保留",
  merge: "断段合并",
  split: "长段拆分",
  move: "乱序调整",
  replace: "错字/格式替换",
  exclude: "噪声排除",
}

interface ProgressShape {
  status: string
  phase: string
  chapterCount: number
  planVersion: number
  plannedCount?: number
}

function stageLabel(progress: ProgressShape): string {
  if (progress.status === "completed") return "已完成"
  if (progress.status === "paused") return "已暂停"
  if (progress.status === "blocked") return "已受阻"
  if (progress.status === "awaiting_queue") return "排队中"
  if (progress.phase === "finalizing") return "收尾阶段"
  if (progress.phase === "planned") {
    return progress.plannedCount !== undefined
      ? "计划处理（预计 " + progress.plannedCount + " 章 · 计划 v" + progress.planVersion + "）"
      : "计划处理（计划 v" + progress.planVersion + "）"
  }
  return "结构校准（已产出 " + progress.chapterCount + " 章）"
}

function errorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "data" in err) {
    const inner: unknown = err.data
    if (typeof inner === "object" && inner !== null && "message" in inner && typeof inner.message === "string") {
      return inner.message
    }
  }
  return err instanceof Error ? err.message : String(err)
}

function safeRatio(raw: number | string): number {
  const value = typeof raw === "string" ? Number(raw) : raw
  return Number.isFinite(value) ? value : 0
}

function percent(ratio: number): string {
  const value = Math.round(ratio * 1000) / 10
  return (Number.isInteger(value) ? String(value) : value.toFixed(1)) + "%"
}

export default function NovelImportTaskPage() {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  const sdk = useSDK()
  const novel = useNovel()
  const novelID = () => params.novelID ?? ""
  const progress = useImportProgress(novelID)
  const report = useImportReport(novelID)
  const control = useImportControl()

  const [configureOpen, setConfigureOpen] = createSignal(false)
  const [targetChars, setTargetChars] = createSignal("")
  const [repairLevel, setRepairLevel] = createSignal<NovelImportRepairLevel>("standard")

  const dirBase64 = () => base64Encode(sdk().directory)
  const goShelf = () => navigate(`/${dirBase64()}/`)
  const goNovel = () => navigate(`/${dirBase64()}/novel/${novelID()}`)

  const data = createMemo(() => progress.data)
  const active = () => {
    const status = data()?.status
    return status === "awaiting_queue" || status === "calibrating" || status === "planned"
  }

  async function send(action: "pause" | "resume" | "retry", extra: Record<string, unknown> = {}) {
    try {
      await control.mutateAsync({ novelID: novelID(), action, ...extra })
    } catch (err) {
      showToast({ variant: "error", title: "操作失败", description: errorMessage(err) })
    }
  }

  async function applyConfigure() {
    const trimmed = targetChars().trim()
    const parsed = trimmed.length === 0 ? undefined : Number.parseInt(trimmed, 10)
    try {
      await control.mutateAsync({
        novelID: novelID(),
        action: "configure",
        ...(parsed !== undefined && Number.isFinite(parsed) && parsed >= 500 && parsed <= 100_000
          ? { targetChapterChars: parsed }
          : {}),
        repairLevel: repairLevel(),
      })
      setConfigureOpen(false)
      showToast({ variant: "success", title: "配置已应用到未开始部分" })
    } catch (err) {
      showToast({ variant: "error", title: "应用失败", description: errorMessage(err) })
    }
  }

  const opEntries = () => Object.entries(report.data?.opCounts ?? {}).filter(([, count]) => count > 0)
  const ratio = () => safeRatio(data()?.progressRatio ?? 0)

  return (
    <div class="flex flex-col h-full items-center p-8 overflow-y-auto">
      <div class="w-full max-w-3xl flex flex-col gap-6">
        <div class="flex items-center justify-between">
          <ButtonV2 variant="ghost-muted" size="small" onClick={goShelf}>
            ← {language.t("novel.bookshelf.open")}
          </ButtonV2>
          <Show when={data()?.status === "completed"}>
            <ButtonV2 variant="contrast" size="small" onClick={goNovel}>
              {language.t("novel.import.report.open")}
            </ButtonV2>
          </Show>
        </div>

        <Show when={progress.isError && isImportNotFound(progress.error)}>
          <div class="flex flex-col items-center gap-3 p-10 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
            <p class="text-sm text-v2-text-text-muted">该书籍不存在或没有导入任务</p>
            <ButtonV2 variant="outline" size="small" onClick={goShelf}>返回书架</ButtonV2>
          </div>
        </Show>

        <Show when={data()}>
          {(current) => (
            <div class="flex flex-col gap-6">
              <div>
                <h2 class="text-lg font-medium text-v2-text-text-base">
                  {novel.currentNovel?.title ?? "导入任务"}
                </h2>
                <p class="text-sm text-v2-text-text-muted mt-1">{stageLabel(current())}</p>
              </div>

              <div class="flex flex-col gap-2">
                <div class="flex items-center justify-between text-sm">
                  <span class="text-v2-text-text-muted">
                    原文处置 {current().processedChars.toLocaleString()} / {current().totalChars.toLocaleString()} 字
                  </span>
                  <span class="text-v2-text-text-base">{percent(ratio())}</span>
                </div>
                <div class="h-2 rounded-full bg-v2-background-bg-layer-02 overflow-hidden">
                  <div
                    class="h-full bg-v2-background-bg-accent transition-all"
                    style={{ width: percent(ratio()) }}
                  />
                </div>
                <div class="flex items-center gap-4 text-xs text-v2-text-text-muted">
                  <span>已产出 {current().chapterCount} 章</span>
                  <Show when={current().carryCount > 0}>
                    <span>待衔接段落 {current().carryCount} 段</span>
                  </Show>
                  <Show
                    when={
                      current().planVersion >= 1 &&
                      current().plannedCount !== undefined &&
                      current().status !== "completed"
                    }
                  >
                    <span>计划 {current().plannedCount} 章</span>
                  </Show>
                </div>
              </div>

              <Show when={current().chapters.length > 0}>
                <div class="flex flex-col gap-2 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02 max-h-72 overflow-y-auto">
                  <div class="text-sm font-medium text-v2-text-text-base">已产出章节</div>
                  <For each={current().chapters}>
                    {(chapter) => (
                      <div class="flex items-center justify-between text-sm">
                        <span class="text-v2-text-text-base truncate">
                          {chapter.order}. {chapter.title}
                        </span>
                        <span class="shrink-0 ml-2 text-xs text-v2-text-text-muted">
                          {language.t("novel.import.wordCount", { count: chapter.wordCount })}
                          <span class="ml-2">
                            {chapter.settingsStage === "done" ? "设定✓" : "设定…"}
                            {chapter.techniqueStage === "done" ? " 技法✓" : " 技法…"}
                          </span>
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>

              <Show when={opEntries().length > 0}>
                <div class="flex flex-col gap-2 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
                  <div class="text-sm font-medium text-v2-text-text-base">正文修复</div>
                  <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-v2-text-text-muted">
                    <For each={opEntries()}>
                      {([kind, count]) => (
                        <span>
                          {OP_LABELS[kind] ?? kind}：{count}
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              </Show>

              {/* 完成态：统一报告 */}
              <Show when={current().status === "completed" && report.data}>
                {(item) => (
                  <div class="flex flex-col gap-3 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
                    <div class="flex items-center gap-4 text-sm text-v2-text-text-muted">
                      <span>计划 v{item().planVersion}</span>
                      <Show when={item().plannedCount !== undefined}>
                        <span>计划 {item().plannedCount} 章</span>
                      </Show>
                      <Show when={item().moveCount > 0}>
                        <span>乱序调整 {item().moveCount} 处</span>
                      </Show>
                    </div>
                    <Show when={(item().excluded.length ?? 0) > 0}>
                      <div class="flex flex-col gap-1">
                        <div class="text-sm font-medium text-v2-text-text-base">已排除内容</div>
                        <For each={item().excluded}>
                          {(excluded) => (
                            <div class="text-xs text-v2-text-text-muted">
                              <span class="text-v2-text-text-base">{excluded.beforeText.slice(0, 60)}</span>
                              <span class="ml-2">{excluded.reason}</span>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                    <Show when={item().unresolvedCount > 0}>
                      <p class="text-xs text-v2-state-fg-warning">未解决项 {item().unresolvedCount} 条，请在书籍内复查</p>
                    </Show>
                  </div>
                )}
              </Show>

              {/* 控制操作 */}
              <div class="flex flex-wrap items-center gap-2">
                <Show when={active()}>
                  <ButtonV2 variant="outline" size="small" onClick={() => void send("pause")} disabled={control.isPending}>
                    暂停
                  </ButtonV2>
                </Show>
                <Show when={current().status === "paused" || current().status === "blocked"}>
                  <ButtonV2 variant="contrast" size="small" onClick={() => void send("resume")} disabled={control.isPending}>
                    恢复
                  </ButtonV2>
                  <ButtonV2 variant="outline" size="small" onClick={() => void send("retry")} disabled={control.isPending}>
                    重试
                  </ButtonV2>
                </Show>
                <Show when={current().status === "paused"}>
                  <ButtonV2
                    variant="ghost-muted"
                    size="small"
                    onClick={() => {
                      setTargetChars("")
                      setConfigureOpen((open) => !open)
                    }}
                  >
                    应用到未开始部分
                  </ButtonV2>
                </Show>
              </div>

              {/* 暂停中配置面板：只触发未开始尾部重规划 */}
              <Show when={configureOpen() && current().status === "paused"}>
                <div class="flex flex-col gap-3 p-4 rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-02">
                  <FieldV2>
                    <FieldV2.Label>目标章长（字符）</FieldV2.Label>
                    <TextInputV2
                      fluid
                      value={targetChars()}
                      onInput={(e) => setTargetChars(e.currentTarget.value)}
                      placeholder="留空保持不变"
                    />
                  </FieldV2>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-v2-text-text-muted">修复强度</span>
                    <select
                      value={repairLevel()}
                      onChange={(e) => setRepairLevel(parseRepairLevel(e.currentTarget.value))}
                      class="h-7 px-2 rounded-[6px] border border-v2-border-border-base bg-v2-background-bg-layer-01 text-v2-text-text-base text-xs outline-none focus:border-v2-border-border-focus transition-colors cursor-pointer"
                    >
                      <option value="standard">常规修复</option>
                      <option value="aggressive">积极清理</option>
                      <option value="off">关闭正文修复</option>
                    </select>
                  </div>
                  <p class="text-xs text-v2-text-text-muted">只重规划未开始部分；已完成章节保持原处理结果。</p>
                  <div class="flex justify-end">
                    <ButtonV2 variant="contrast" size="small" onClick={() => void applyConfigure()} disabled={control.isPending}>
                      应用配置
                    </ButtonV2>
                  </div>
                </div>
              </Show>
            </div>
          )}
        </Show>
      </div>
    </div>
  )
}

