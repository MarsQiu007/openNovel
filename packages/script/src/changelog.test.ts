import { describe, expect, test } from "bun:test"
import { releaseNoteType } from "./changelog"

describe("releaseNoteType", () => {
  test("收录 feat 与 fix（含 scope、破坏性标记与大小写变体）", () => {
    // 样例取自真实提交（v0.0.9..v0.0.10 区间等）
    expect(releaseNoteType("feat(app): 分栏宽度改为动态派生边界")).toBe("feat")
    expect(releaseNoteType("fix(opennovel): SSE 超时先兑现流错误再回收 cancel")).toBe("fix")
    expect(releaseNoteType("feat!: 破坏性新功能")).toBe("feat")
    expect(releaseNoteType("fix(plugin)!: 破坏性修复")).toBe("fix")
    expect(releaseNoteType("FIX(core): 大写类型")).toBe("fix")
  })

  test("排除非 feat/fix 类型", () => {
    expect(releaseNoteType("docs(openspec): 完成任务 2.1 schema 批次（0 项修复，typecheck 通过）")).toBeUndefined()
    expect(releaseNoteType("chore(release): bump version to 0.0.10")).toBeUndefined()
    expect(releaseNoteType("test(app): prompt 持久化用例迁移至目录 scope")).toBeUndefined()
    expect(releaseNoteType("ci(version): preview channel 也创建并推送 git tag")).toBeUndefined()
    expect(releaseNoteType("refactor(app): 清理草稿链路残留死代码")).toBeUndefined()
    expect(releaseNoteType("revert(opennovel): 回退 httpapi 测试夹具的查询串改动")).toBeUndefined()
    expect(releaseNoteType("style: format")).toBeUndefined()
    expect(releaseNoteType("build: 调整构建")).toBeUndefined()
  })

  test("排除 merge、非规范提交与前缀子串误命中", () => {
    expect(releaseNoteType("Merge remote-tracking branch 'origin/main' into session-book-only")).toBeUndefined()
    expect(releaseNoteType("Initial commit")).toBeUndefined()
    expect(releaseNoteType("feature: 非规范前缀")).toBeUndefined()
    expect(releaseNoteType("fixup! feat: 被折叠的提交")).toBeUndefined()
  })
})
