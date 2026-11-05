export * as ConfigHealth from "./health"

import { Context, Effect, Layer, Schema, SynchronizedRef } from "effect"
import { makeGlobalNode } from "../effect/app-node"
import { ConfigV1 } from "./v1/config"
import { ConfigPlugin } from "./plugin"
import { classifyPluginSpec, NOVEL_WRITER_V2_PLUGIN } from "./v1/migrate"

export class LoadRecord extends Schema.Class<LoadRecord>("ConfigHealth.LoadRecord")({
  raw: Schema.String,
  package: Schema.String,
  reason: Schema.String,
}) {}

export class Issue extends Schema.Class<Issue>("ConfigHealth.Issue")({
  id: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
  message: Schema.String,
  file: Schema.String,
  keyPath: Schema.optional(Schema.String),
  fixSummary: Schema.optional(Schema.String),
}) {}

/** 修复动作（服务层私有）：对 updateGlobal 的 ConfigV1.Info payload draft 原地重写 */
export type Fix = (draft: ConfigV1.Info) => void

export interface Finding {
  readonly issue: Issue
  readonly apply?: Fix
}

export interface EvaluateInput {
  readonly info: ConfigV1.Info
  readonly file: string
  readonly records: readonly LoadRecord[]
  readonly knownProviders: ReadonlySet<string>
  readonly legacyFiles: readonly string[]
}

const pluginRaw = (item: ConfigPlugin.Plugin) => (typeof item === "string" ? item : item.package)

// 第一方死条目的修复目标：V1 入口重定向与 @opennovel-ai/* 统一重写为现行 V2 包 id；
// 现行 id 自身不可解析时无修复可给（当前环境装不出该插件，标注交由用户处置）
function pluginFixTarget(raw: string): { target: string; summary: string } | undefined {
  if (raw === NOVEL_WRITER_V2_PLUGIN) return undefined
  if (classifyPluginSpec(raw) === "redirect") return { target: NOVEL_WRITER_V2_PLUGIN, summary: `将条目重写为 ${NOVEL_WRITER_V2_PLUGIN}` }
  if (raw.startsWith("@opennovel-ai/")) return { target: NOVEL_WRITER_V2_PLUGIN, summary: `将条目重写为 ${NOVEL_WRITER_V2_PLUGIN}` }
  if (classifyPluginSpec(raw) === "drop") return { target: "", summary: "移除已摘除的 V1 入口条目" }
  return undefined
}

function pluginFinding(item: ConfigPlugin.Plugin, index: number, input: EvaluateInput): Finding | undefined {
  const raw = pluginRaw(item)
  const record = input.records.find((entry) => entry.raw === raw || entry.package === raw)
  if (!record) return undefined
  const fix = pluginFixTarget(raw)
  return {
    issue: new Issue({
      id: `plugin:${raw}`,
      severity: "error",
      message: `外部插件条目加载失败（${record.reason}）`,
      file: input.file,
      keyPath: `plugins[${index}]`,
      ...(fix ? { fixSummary: fix.summary } : {}),
    }),
    apply: fix
      ? (draft) => {
          const rest = (draft.plugins ?? []).filter((entry) => pluginRaw(entry) !== raw)
          draft.plugins = fix.target === "" ? rest : rest.some((entry) => pluginRaw(entry) === fix.target) ? rest : [...rest, fix.target]
        }
      : undefined,
  }
}

function agentFindings(name: string, model: string, input: EvaluateInput): Finding[] {
  const [providerID, ...modelID] = model.split("/")
  if (!providerID || modelID.join("/") === "") {
    return [
      {
        issue: new Issue({
          id: `agent-model:${name}`,
          severity: "warning",
          message: `agent "${name}" 的模型引用 "${model}" 不是有效的 provider/model 形态`,
          file: input.file,
          keyPath: `agent.${name}.model`,
        }),
      },
    ]
  }
  if (input.knownProviders.has(providerID)) return []
  return [
    {
      issue: new Issue({
        id: `agent-model:${name}`,
        severity: "warning",
        message: `agent "${name}" 的模型引用 "${model}" 指向的提供商 "${providerID}" 不在现行提供商目录中`,
        file: input.file,
        keyPath: `agent.${name}.model`,
      }),
    },
  ]
}

export function evaluate(input: EvaluateInput): Finding[] {
  const findings = (input.info.plugins ?? [])
    .map((item, index) => pluginFinding(item, index, input))
    .filter((finding): finding is Finding => finding !== undefined)
  for (const [name, agent] of Object.entries(input.info.agent ?? {})) {
    if (agent.model !== undefined) findings.push(...agentFindings(name, agent.model, input))
  }
  for (const file of input.legacyFiles) {
    findings.push({
      issue: new Issue({
        id: `legacy:${file}`,
        severity: "warning",
        message: `存在旧式 agent 定义残留：${file}（现行版本已内置同等角色，可手动清理）`,
        file,
      }),
    })
  }
  return findings
}

export interface Interface {
  /** 装载路径上报：按 package 去重保留最近一条，进程内共享 */
  readonly record: (input: LoadRecord) => Effect.Effect<void>
  /** 装载成功清掉该包的历史失败记录（上次启动的残留不应永恒误报） */
  readonly clear: (packageName: string) => Effect.Effect<void>
  readonly records: () => Effect.Effect<readonly LoadRecord[]>
}

export class Service extends Context.Service<Service, Interface>()("@opennovel/ConfigHealth") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const registry = yield* SynchronizedRef.make<ReadonlyArray<LoadRecord>>([])
    const record = Effect.fn("ConfigHealth.record")(function* (input: LoadRecord) {
      yield* SynchronizedRef.update(registry, (current) => [
        ...current.filter((entry) => entry.package !== input.package),
        input,
      ])
    })
    const clear = Effect.fn("ConfigHealth.clear")(function* (packageName: string) {
      yield* SynchronizedRef.update(registry, (current) => current.filter((entry) => entry.package !== packageName))
    })
    return Service.of({
      record,
      clear,
      records: () => SynchronizedRef.get(registry),
    })
  }),
)

export const node = makeGlobalNode({ service: Service, layer, deps: [] })
