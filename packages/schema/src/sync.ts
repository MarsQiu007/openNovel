export * as Sync from "./sync"

import { Schema } from "effect"
import { optional } from "./schema"

/** 云盘同步的连接与库级状态类型。密码不属于本契约——只进凭据存储。 */

export interface Connection extends Schema.Schema.Type<typeof Connection> {}
export const Connection = Schema.Struct({
  url: Schema.String,
  username: Schema.String,
  remoteRoot: Schema.String,
}).annotate({ identifier: "Sync.Connection" })

export const ProjectState = Schema.Literals([
  "in_sync",
  "local_ahead",
  "remote_ahead",
  "new_local",
  "new_remote",
  "conflict",
  "pending_delete",
])
export type ProjectState = typeof ProjectState.Type

export interface ProjectStatus extends Schema.Schema.Type<typeof ProjectStatus> {}
export const ProjectStatus = Schema.Struct({
  name: Schema.String,
  state: ProjectState,
  lastSyncedAt: optional(Schema.Number),
  /** 项目内小说标题（展示用，尽力而为） */
  novels: optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "Sync.ProjectStatus" })

/** 库级同步状态：连接 + 工作根目录 + 所有项目 */
export interface LibraryStatus extends Schema.Schema.Type<typeof LibraryStatus> {}
export const LibraryStatus = Schema.Struct({
  connection: optional(Connection),
  rootDir: optional(Schema.String),
  projects: Schema.Array(ProjectStatus),
}).annotate({ identifier: "Sync.LibraryStatus" })

export const RunAction = Schema.Literals(["uploaded", "downloaded", "deleted_remote"])
export type RunAction = typeof RunAction.Type

export interface RunResult extends Schema.Schema.Type<typeof RunResult> {}
export const RunResult = Schema.Struct({
  name: Schema.String,
  action: RunAction,
}).annotate({ identifier: "Sync.RunResult" })

/** 同名异源：远端属于另一台机器创建的同名项目 */
export interface PairConflict extends Schema.Schema.Type<typeof PairConflict> {}
export const PairConflict = Schema.Struct({
  kind: Schema.Literal("pair_conflict"),
  name: Schema.String,
  remote: Schema.Struct({
    device: Schema.String,
    at: Schema.Number,
    novels: Schema.Array(Schema.String),
  }),
}).annotate({ identifier: "Sync.PairConflict" })

/** 双方都改且内容时间过近，不擅自仲裁 */
export interface TieConflict extends Schema.Schema.Type<typeof TieConflict> {}
export const TieConflict = Schema.Struct({
  kind: Schema.Literal("tie_conflict"),
  name: Schema.String,
  localTime: Schema.NullOr(Schema.Number),
  remoteTime: Schema.NullOr(Schema.Number),
}).annotate({ identifier: "Sync.TieConflict" })

/** 单次运行要删除多个远端项目，需人工确认 */
export interface DeleteConfirm extends Schema.Schema.Type<typeof DeleteConfirm> {}
export const DeleteConfirm = Schema.Struct({
  kind: Schema.Literal("delete_confirm"),
  names: Schema.Array(Schema.String),
}).annotate({ identifier: "Sync.DeleteConfirm" })

export const Decision = Schema.Union([PairConflict, TieConflict, DeleteConfirm])
export type Decision = typeof Decision.Type

/** 一键同步的产出：已执行的动作 + 待人工决策的项 */
export interface RunOutput extends Schema.Schema.Type<typeof RunOutput> {}
export const RunOutput = Schema.Struct({
  results: Schema.Array(RunResult),
  decisions: Schema.Array(Decision),
}).annotate({ identifier: "Sync.RunOutput" })

export const ResolveAction = Schema.Literals(["keep_local", "keep_remote", "keep_both", "confirm_delete", "skip"])
export type ResolveAction = typeof ResolveAction.Type

export interface ResolveInput extends Schema.Schema.Type<typeof ResolveInput> {}
export const ResolveInput = Schema.Struct({
  /** keep_local/keep_remote/keep_both 的目标项目名 */
  name: optional(Schema.String),
  action: ResolveAction,
  /** confirm_delete 的项目名列表 */
  names: optional(Schema.Array(Schema.String)),
}).annotate({ identifier: "Sync.ResolveInput" })

export interface RootInput extends Schema.Schema.Type<typeof RootInput> {}
export const RootInput = Schema.Struct({
  rootDir: Schema.String,
}).annotate({ identifier: "Sync.RootInput" })

export interface ConnectionInput extends Schema.Schema.Type<typeof ConnectionInput> {}
export const ConnectionInput = Schema.Struct({
  url: Schema.String,
  username: Schema.String,
  password: Schema.String,
  remoteRoot: optional(Schema.String),
}).annotate({ identifier: "Sync.ConnectionInput" })

export interface TestResult extends Schema.Schema.Type<typeof TestResult> {}
export const TestResult = Schema.Struct({
  ok: Schema.Boolean,
  error: optional(Schema.String),
}).annotate({ identifier: "Sync.TestResult" })
