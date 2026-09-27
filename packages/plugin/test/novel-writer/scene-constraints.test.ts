import { describe, test, expect } from "bun:test"
import { compileSceneChecklist } from "../../src/novel-writer/scene-constraints.js"

const FULL_OUTLINE = `## 章节目标

测试章节目标。

## 关键场景

### 场景一：开场

- **地点**：青阳镇客栈
- **时间**：清晨
- **出场角色**：林凡、店小二
- **场景概要**：林凡在客栈听闻秘境开启的消息，决定前往。
- **字数预估**：500

### 场景二：发展

- **地点**：镇外古道
- **时间**：正午
- **出场角色**：林凡、苏婉儿
- **场景概要**：林凡在古道遭遇苏婉儿，二人结伴同行。
- **字数预估**：800

### 场景三：高潮 / 转折

- **地点**：秘境入口
- **时间**：黄昏
- **出场角色**：林凡、苏婉儿、黑衣人
- **场景概要**：黑衣人出手抢夺入口信物，林凡被迫亮出底牌。
- **字数预估**：700

### 场景四：收尾

- **地点**：秘境内
- **时间**：入夜
- **出场角色**：林凡、苏婉儿
- **场景概要**：二人进入秘境，发现内部与传闻完全不同，留下悬念。
- **字数预估**：500

## 角色出场

| 角色 | 出场场景 | 作用 | 状态变化 |
|------|----------|------|----------|
| 林凡 | 场景一 | 主角 | 无 |
`

describe("compileSceneChecklist", () => {
  test("标准四场景章纲编译成功，场景概要呈现为必须发生", () => {
    const checklist = compileSceneChecklist(FULL_OUTLINE)
    expect(checklist).not.toBeNull()
    expect(checklist).toContain("### 场景一：开场")
    expect(checklist).toContain("### 场景四：收尾")
    expect(checklist).toContain("- 地点：青阳镇客栈")
    expect(checklist).toContain("- 必须发生：林凡在客栈听闻秘境开启的消息，决定前往。")
    expect(checklist).not.toContain("- 场景概要：")
  })

  test("字段为空或待填写时跳过该字段", () => {
    const outline = `## 关键场景

### 场景一：开场

- **地点**：（待填写）
- **时间**：
- **出场角色**：林凡
- **场景概要**：林凡出场。
`
    const checklist = compileSceneChecklist(outline)
    expect(checklist).not.toBeNull()
    expect(checklist).toContain("### 场景一：开场")
    expect(checklist).toContain("- 出场角色：林凡")
    expect(checklist).not.toContain("- 地点：")
    expect(checklist).not.toContain("- 时间：")
  })

  test("无关键场景段时返回 null", () => {
    expect(compileSceneChecklist("# 总纲\n\n## 世界观\n\n一些设定。")).toBeNull()
  })

  test("有关键场景段但无场景标题时返回 null", () => {
    const outline = `## 关键场景

- **地点**：青阳镇客栈
`
    expect(compileSceneChecklist(outline)).toBeNull()
  })

  test("解析范围截止于下一个二级标题", () => {
    const checklist = compileSceneChecklist(FULL_OUTLINE)
    expect(checklist).not.toBeNull()
    // 「## 角色出场」表格不属于场景清单
    expect(checklist).not.toContain("出场场景")
    expect(checklist).not.toContain("状态变化")
  })

  test("未提供关键场景清单时不输出半成品（截断章纲只含入口标题）", () => {
    expect(compileSceneChecklist("## 关键场景")).toBeNull()
  })
})