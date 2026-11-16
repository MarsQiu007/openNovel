/**
 * 设定中心 — 写作风格表单（tone / pov / tense / 字数上下限常驻字段 / rules 分区编辑）。
 *
 * style-editor-structure 重构：规则从单一文本域改为分区 + 键值成对行编辑
 * （行数组为编辑态事实源，分组是键名的纯派生视图，见 style-rules-model）；
 * 空键 / 重复键 / 保留键行保存前拦截并标示，不再静默丢弃或覆盖。
 * 字数上下限常驻字段自 chapter-length-range 迁入：回填排除 chapter_length /
 * chapter_length_max 两键（parseLengthFields 按读取侧口径回显非法存量值），
 * 保存时以字段值混入 rules，上限可空 = 不设上限；曾开启篇幅限制的书籍由
 * 存量迁移折算为显式上下限。
 * 分区标题与校验提示为硬编码中文（沿用界面内既有文案先例）。
 */
import { type Accessor, For, createEffect, createMemo, createSignal, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import { useStyleGuide, useUpdateStyleGuide } from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import {
  STYLE_RULE_SECTIONS,
  groupRowsBySection,
  parseLengthFields,
  rowsFromRecord,
  rowsToRecord,
  validateLengthFields,
  validateRows,
  type RowIssue,
  type StyleRuleRow,
} from "./style-rules-model"

export type StyleGuideEditorProps = {
  novelID: Accessor<string>
}

const ROW_ISSUE_HINT: Record<RowIssue, string> = {
  empty_key: "键名不能为空",
  duplicate_key: "键名与其他规则行重复",
  reserved_key: "该键由常驻字数上下限字段承载，请改用上方字段",
}

const LENGTH_LOWER_ISSUE_HINT = "下限须为正整数"
const LENGTH_UPPER_ISSUE_HINT = "上限须为不小于下限的正整数，或留空不设上限"

export function StyleGuideEditor(props: StyleGuideEditorProps) {
  const language = useLanguage()
  const query = useStyleGuide(props.novelID)
  const update = useUpdateStyleGuide()
  const [tone, setTone] = createSignal("")
  const [pov, setPov] = createSignal("")
  const [tense, setTense] = createSignal("")
  const [rows, setRows] = createStore<StyleRuleRow[]>([])
  const [lengthLower, setLengthLower] = createSignal("2500")
  const [lengthUpper, setLengthUpper] = createSignal("")
  const [showIssues, setShowIssues] = createSignal(false)

  // 初次载入 / 远端变更时填充表单；字数上下限由常驻字段独立承载（非法存量值按读取侧口径回显），不进编辑行
  createEffect(() => {
    const data = query.data
    if (!data) return
    setTone(data.tone)
    setPov(data.pov)
    setTense(data.tense)
    setRows(rowsFromRecord(data.rules))
    const fields = parseLengthFields(data.rules)
    setLengthLower(fields.lower)
    setLengthUpper(fields.upper)
  })

  // 校验与分区都是行的纯派生视图；showIssues 保存失败后置真，避免键入过程中的中间态噪音
  const issues = createMemo(() => validateRows(rows))
  const lengthIssues = createMemo(() => validateLengthFields(lengthLower(), lengthUpper()))
  const grouped = createMemo(() => groupRowsBySection(rows))

  function addRow() {
    setRows(rows.length, { key: "", value: "" })
  }

  function removeRow(target: StyleRuleRow) {
    setRows(rows.filter((row) => row !== target))
  }

  async function save() {
    if (issues().size > 0) {
      setShowIssues(true)
      showToast({ variant: "error", title: "存在无效规则行，请修正标红项后再保存" })
      return
    }
    if (lengthIssues().lower !== undefined || lengthIssues().upper !== undefined) {
      setShowIssues(true)
      showToast({ variant: "error", title: "存在无效输入，请修正标红项后再保存" })
      return
    }
    setShowIssues(false)
    await update.mutateAsync({
      novelID: props.novelID(),
      tone: tone().trim(),
      pov: pov().trim(),
      tense: tense().trim(),
      rules: rowsToRecord(rows, lengthLower(), lengthUpper()),
    })
    showToast({
      variant: "success",
      title: language.t("novel.settings.style.saved"),
    })
  }

  return (
    <div class="mx-auto flex max-w-3xl flex-col gap-4 p-6">
      <Show
        when={!query.isLoading}
        fallback={
          <div class="flex items-center justify-center py-8">
            <Spinner class="w-5 h-5 text-v2-text-text-muted" />
          </div>
        }
      >
        <div class="flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={tone()}
              onInput={(e) => setTone(e.currentTarget.value)}
              placeholder={language.t("novel.style.tone")}
            />
          </div>
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={pov()}
              onInput={(e) => setPov(e.currentTarget.value)}
              placeholder={language.t("novel.style.pov")}
            />
          </div>
          <div class="flex-1 min-w-0">
            <TextInputV2
              fluid
              value={tense()}
              onInput={(e) => setTense(e.currentTarget.value)}
              placeholder={language.t("novel.style.tense")}
            />
          </div>
        </div>

        {/* 键名建议走原生 datalist：建议可选、自定义键不受限 */}
        <datalist id="style-rule-key-suggestions">
          <For each={STYLE_RULE_SECTIONS.flatMap((section) => [...section.keys])}>
            {(key) => <option value={key} />}
          </For>
        </datalist>

        {/* 字数上下限常驻字段：读取侧按此值启用区间双向门禁，上限留空 = 不设上限 */}
        <div class="flex flex-col gap-1">
          <div class="text-sm font-medium text-v2-text-text-secondary">章节字数</div>
          <div class="flex items-center gap-2">
            <div class="w-44 shrink-0">
              <TextInputV2
                fluid
                invalid={showIssues() && lengthIssues().lower !== undefined}
                title={showIssues() && lengthIssues().lower !== undefined ? LENGTH_LOWER_ISSUE_HINT : undefined}
                value={lengthLower()}
                placeholder="2500"
                onInput={(e) => setLengthLower(e.currentTarget.value)}
              />
              <div class="mt-1 text-xs text-v2-text-text-muted">字数下限（每章至少）</div>
            </div>
            <div class="w-44 shrink-0">
              <TextInputV2
                fluid
                invalid={showIssues() && lengthIssues().upper !== undefined}
                title={showIssues() && lengthIssues().upper !== undefined ? LENGTH_UPPER_ISSUE_HINT : undefined}
                value={lengthUpper()}
                placeholder="留空 = 不设上限"
                onInput={(e) => setLengthUpper(e.currentTarget.value)}
              />
              <div class="mt-1 text-xs text-v2-text-text-muted">字数上限（可空）</div>
            </div>
          </div>
          <div class="text-xs text-v2-text-text-muted">
            曾开启篇幅限制的书籍已折算为显式上下限（下限约为原目标 85%），可按需调整
          </div>
        </div>

        <For each={grouped()}>
          {(section) => (
            <div class="flex flex-col gap-2">
              <div class="text-sm font-medium text-v2-text-text-secondary">{section.title}</div>
              <For each={section.rows}>
                {(row) => {
                  // 行下标按引用实时求解（响应式）：删除行后其余行下标随之变化，闭包常量会错位
                  const index = createMemo(() => rows.indexOf(row))
                  const issue = () => (showIssues() ? issues().get(index()) : undefined)
                  return (
                    <div class="flex items-center gap-2">
                      <div class="w-44 shrink-0">
                        <TextInputV2
                          fluid
                          invalid={!!issue()}
                          title={issue() ? ROW_ISSUE_HINT[issue()!] : undefined}
                          value={row.key}
                          list="style-rule-key-suggestions"
                          placeholder="键"
                          onInput={(e) => setRows(index(), "key", e.currentTarget.value)}
                        />
                      </div>
                      <div class="flex-1 min-w-0">
                        <TextInputV2
                          fluid
                          value={row.value}
                          placeholder="值"
                          onInput={(e) => setRows(index(), "value", e.currentTarget.value)}
                        />
                      </div>
                      <ButtonV2 variant="ghost" size="small" onClick={() => removeRow(row)}>
                        删除
                      </ButtonV2>
                    </div>
                  )
                }}
              </For>
            </div>
          )}
        </For>

        <div>
          <ButtonV2 variant="ghost" size="small" onClick={addRow}>
            添加规则
          </ButtonV2>
        </div>

        <div>
          <ButtonV2 variant="contrast" size="small" onClick={() => void save()} disabled={update.isPending}>
            {update.isPending ? language.t("novel.settings.entry.saving") : language.t("common.action.save")}
          </ButtonV2>
        </div>
      </Show>
    </div>
  )
}
