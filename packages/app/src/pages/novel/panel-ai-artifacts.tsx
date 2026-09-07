import { type Accessor, For, Show } from "solid-js"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { useAiArtifacts } from "@/context/novel-queries"

type Props = {
  novelID: Accessor<string>
  selectedChapterId: Accessor<string | null>
}

const HOOK_TYPE_LABELS: Record<string, string> = {
  foreshadow_plant: "埋设伏笔",
  face_slap: "打脸反转",
  power_up: "能力升级",
  emotional_peak: "情感高潮",
}

function SectionTitle(props: { title: string; count: number; empty: string }) {
  return (
    <div class="flex items-center justify-between gap-2">
      <h3 class="text-sm font-semibold text-v2-text-text-base">{props.title}</h3>
      <span class="text-xs text-v2-text-text-faint">{props.count > 0 ? `${props.count}` : props.empty}</span>
    </div>
  )
}

export function AiArtifactsPanel(props: Props) {
  const artifacts = useAiArtifacts(props.novelID)
  return (
    <div class="flex flex-col gap-4 px-4 py-4">
      <Show
        when={!artifacts.isLoading}
        fallback={
          <div class="flex items-center justify-center py-8">
            <Spinner class="h-6 w-6 text-v2-text-text-muted" />
          </div>
        }
      >
        <Show
          when={!artifacts.isError}
          fallback={
            <div class="flex flex-col items-center gap-2 py-6 text-sm text-v2-text-text-muted">
              <span>AI 产出加载失败</span>
              <ButtonV2 size="small" variant="neutral" onClick={() => void artifacts.refetch()}>
                重试
              </ButtonV2>
            </div>
          }
        >
          <Show when={artifacts.data} keyed>
            {(data) => (
              <>
                <section class="flex flex-col gap-2">
                  <SectionTitle title="章节摘要" count={data.chapterSummaries.length} empty="暂无" />
                  <Show
                    when={data.chapterSummaries.length > 0}
                    fallback={<p class="text-xs text-v2-text-text-faint">生成章节并完成状态提取后，这里会显示摘要。</p>}
                  >
                    <div class="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
                      <For each={data.chapterSummaries}>
                        {(item) => (
                          <article
                            classList={{
                              "rounded border border-v2-border-border-base bg-v2-background-bg-layer-01 p-2 text-xs": true,
                              "border-v2-state-border-info": item.chapterId === props.selectedChapterId(),
                            }}
                          >
                            <div class="flex items-center justify-between gap-2">
                              <span class="truncate font-medium text-v2-text-text-base">
                                第{item.chapterOrder}章 {item.title}
                              </span>
                              {item.chapterId === props.selectedChapterId() && (
                                <span class="shrink-0 text-v2-state-fg-info">当前</span>
                              )}
                            </div>
                            <p class="mt-1 whitespace-pre-wrap text-v2-text-text-muted">{item.summary}</p>
                            <Show when={item.keyEvents.length > 0}>
                              <div class="mt-1 flex flex-col gap-1">
                                {item.keyEvents.map((event) => (
                                  <span class="text-v2-text-text-faint">· {event}</span>
                                ))}
                              </div>
                            </Show>
                          </article>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>

                <section class="flex flex-col gap-2">
                  <SectionTitle title="钩子轮换" count={data.hookRotation.records.length} empty="暂无" />
                  <Show when={data.hookRotation.warning}>
                    <p class="rounded border border-v2-state-border-warning bg-v2-state-bg-warning p-2 text-xs text-v2-state-fg-warning">
                      {data.hookRotation.warning}
                    </p>
                  </Show>
                  <Show
                    when={data.hookRotation.records.length > 0}
                    fallback={<p class="text-xs text-v2-text-text-faint">还没有钩子记录。</p>}
                  >
                    <div class="flex flex-wrap gap-1">
                      <For each={Object.entries(data.hookRotation.counts)}>
                        {([hookType, count]) => (
                          <span class="rounded bg-v2-background-bg-layer-01 px-1.5 py-0.5 text-xs text-v2-text-text-muted">
                            {HOOK_TYPE_LABELS[hookType] ?? hookType} · {count}
                          </span>
                        )}
                      </For>
                    </div>
                    <div class="flex max-h-40 flex-col gap-1 overflow-y-auto pr-1">
                      <For each={data.hookRotation.records.slice(0, 20)}>
                        {(record) => (
                          <div class="flex items-center justify-between gap-2 text-xs">
                            <span class="text-v2-text-text-muted">
                              {HOOK_TYPE_LABELS[record.hookType] ?? record.hookType}
                            </span>
                            <span class="text-v2-text-text-faint">
                              {record.chapterOrder == null ? "未关联章节" : `第${record.chapterOrder}章`}
                            </span>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </section>

                <section class="flex flex-col gap-2">
                  <SectionTitle
                    title="卷/段汇总"
                    count={data.volumeSummaries.length + data.segmentSummaries.length}
                    empty="暂无"
                  />
                  <Show
                    when={data.volumeSummaries.length > 0 || data.segmentSummaries.length > 0}
                    fallback={<p class="text-xs text-v2-text-text-faint">还没有卷或段汇总。</p>}
                  >
                    <For each={data.volumeSummaries}>
                      {(item) => (
                        <article class="rounded border border-v2-border-border-base bg-v2-background-bg-layer-01 p-2 text-xs">
                          <h4 class="font-medium text-v2-text-text-base">
                            第{item.volumeOrder}卷 {item.volumeTitle}
                          </h4>
                          <p class="mt-1 whitespace-pre-wrap text-v2-text-text-muted">{item.summary}</p>
                          <Show when={item.charActive.length > 0}>
                            <p class="mt-1 text-v2-text-text-faint">活跃：{item.charActive.join("、")}</p>
                          </Show>
                          <Show when={item.charDormant.length > 0}>
                            <p class="text-v2-text-text-faint">休眠：{item.charDormant.join("、")}</p>
                          </Show>
                          <Show when={item.threadsOpen.length > 0}>
                            <p class="text-v2-text-text-faint">开放线索：{item.threadsOpen.join("、")}</p>
                          </Show>
                          <Show when={item.threadsClosed.length > 0}>
                            <p class="text-v2-text-text-faint">关闭线索：{item.threadsClosed.join("、")}</p>
                          </Show>
                        </article>
                      )}
                    </For>
                    <For each={data.segmentSummaries}>
                      {(item) => (
                        <article class="rounded border border-v2-border-border-base p-2 text-xs">
                          <h4 class="font-medium text-v2-text-text-base">
                            第{item.startChapter}-{item.endChapter}章
                          </h4>
                          <p class="mt-1 whitespace-pre-wrap text-v2-text-text-muted">{item.summary}</p>
                        </article>
                      )}
                    </For>
                  </Show>
                </section>
              </>
            )}
          </Show>
        </Show>
      </Show>
    </div>
  )
}