/**
 * 书稿内部分层写作规范的发现（agent-instruction-layering）。
 *
 * 约定 `<project>/.novel/instructions/` 目录下按层级命名：
 * `book.md`（全书）→ `volume-<n>.md`（第 n 卷）→ `chapter-<n>.md`（第 n 章）。
 * 作者直接维护 Markdown 文件；发现结果按远→近排序，渲染时近者后注入、
 * 自然优先。缺失层静默跳过；读取失败（权限/编码）的层以 degraded 标记
 * 保留，由渲染层附降级提示，不阻塞快照组装。
 *
 * 与 core instruction-context 的边界：项目级 AGENTS.md 分层发现走 core 的
 * system-context 通道；本模块只管书稿内部（全书/卷/章）规范，走快照 P4 通道。
 */
import { existsSync, readFileSync } from "fs"
import { join } from "path"

/** 一层写作规范：来源路径与内容；degraded 表示读取失败（content 为空串）。 */
export type InstructionLayer = {
  path: string
  content: string
  degraded?: boolean
}

/**
 * 收集当前章生效的分层规范（远→近序）。
 *
 * @param directory 项目目录（与 getDb 同义；缺省回落 process.cwd()）
 * @param volumeOrder 当前章所属卷序号；无卷书稿传 null（只生效 book/chapter 两层）
 * @param chapterNumber 当前章序号
 */
export function discoverInstructions(
  directory: string | null | undefined,
  volumeOrder: number | null,
  chapterNumber: number,
): InstructionLayer[] {
  const base = join(directory ?? process.cwd(), ".novel", "instructions")
  const paths = [
    join(base, "book.md"),
    ...(volumeOrder === null ? [] : [join(base, `volume-${volumeOrder}.md`)]),
    join(base, `chapter-${chapterNumber}.md`),
  ]
  const layers: InstructionLayer[] = []
  for (const path of paths) {
    if (!existsSync(path)) continue
    try {
      layers.push({ path, content: readFileSync(path, "utf-8").trim() })
    } catch {
      layers.push({ path, content: "", degraded: true })
    }
  }
  // 空文件不产生注入；读取失败的层保留标记供渲染层提示
  return layers.filter((layer) => layer.degraded === true || layer.content.length > 0)
}
