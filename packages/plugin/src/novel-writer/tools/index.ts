/**
 * 88 个 V2 写作工具的聚合 barrel（runtime-v2-cutover B 组）。
 *
 * 各域文件从 novel-writer.ts 机械转换而来；带会话归属解析（resolveSessionNovel）
 * 的域为工厂形态，注入 SessionDomain。窗口期 V1 入口保留同名 zod 版工具。
 */
import type { SessionDomain } from "../../v2/effect/session.js"
import { createAnnotationsTools } from "./annotations.js"
import { createArcsTools } from "./arcs.js"
import { cascadeTools } from "./cascade.js"
import { chapterTools } from "./chapter.js"
import { charactersTools } from "./characters.js"
import { contextTools } from "./context.js"
import { foreshadowTools } from "./foreshadow.js"
import { hooksTools } from "./hooks.js"
import { createMiscTools } from "./misc.js"
import { novelTools } from "./novel.js"
import { createOutlineTools } from "./outline.js"
import { pendingTools } from "./pending.js"
import { relationshipsTools } from "./relationships.js"
import { createReviewTools } from "./review.js"
import { settingsTools } from "./settings.js"
import { settingsOpsTools } from "./settings-ops.js"
import { stateTools } from "./state.js"
import { techniqueTools } from "./technique.js"
import { versionsTools } from "./versions.js"

/** 聚合全部写作工具：13 域（settings 拆查询/操作两文件），共 88 个。 */
export function createNovelWriterTools(deps: { session: SessionDomain }) {
  return {
    ...chapterTools,
    ...charactersTools,
    ...createOutlineTools(deps),
    ...contextTools,
    ...createReviewTools(deps),
    ...stateTools,
    ...versionsTools,
    ...settingsTools,
    ...settingsOpsTools,
    ...pendingTools,
    ...relationshipsTools,
    ...novelTools,
    ...foreshadowTools,
    ...hooksTools,
    ...cascadeTools,
    ...createArcsTools(deps),
    ...createAnnotationsTools(deps),
    ...createMiscTools(deps),
    ...techniqueTools,
  }
}
