/**
 * 角色档案 agent 指示静态断言（character-profile task 3.1 / 3.3）。
 *
 * 固化 architect 初始化建档指示与 writer 档案消费规则的关键句，
 * 防止后续改写 prompt 时静默丢失档案语义（dispatch-routing 先例）。
 */
import { describe, expect, test } from "bun:test"
import { architectAgent } from "../../src/novel-writer/agents/architect.js"
import { auditorAgent } from "../../src/novel-writer/agents/auditor.js"
import { writerAgent } from "../../src/novel-writer/agents/writer.js"

describe("architect 初始化建档指示（character-profile）", () => {
  const prompt = architectAgent.prompt

  test("character 类型 data 文档包含 profile 档案字段与维度清单", () => {
    expect(prompt).toContain("profile：可选角色档案对象（character-profile），逐维度结构化")
    expect(prompt).toContain("appearance 身体特征 / speech 说话习惯 / tone 语气 / personality 个性 / mannerism 习惯动作 / extensions 自定义设定 KV")
    expect(prompt).toContain("整包语义")
  })

  test("习惯动作按需产出：点名才必填，未点名不编造", () => {
    expect(prompt).toContain("mannerism 仅在用户点名「习惯动作」时必填，未点名留空不编造")
    expect(prompt).toContain("mannerism（习惯动作）：用户点名「习惯动作」时必填；未点名时留空，不强行编造")
  })

  test("主要角色逐维建档且走 save_novel_settings 落库", () => {
    expect(prompt).toContain("**角色档案（character-profile）**")
    expect(prompt).toContain("appearance/speech/tone/personality 逐维产出")
    expect(prompt).toContain("写入 profile.extensions")
    // 落库路径仍是 save_novel_settings 的 character 类型
    expect(prompt).toContain("调用 save_novel_settings 工具，将以下 7 类设定写入数据库")
  })
})

describe("writer 档案消费规则（character-profile）", () => {
  const prompt = writerAgent.prompt

  test("规则 21 对话辨识度引用档案 speech/tone（MUST 体现语癖与语气）", () => {
    expect(prompt).toContain("档案说话习惯（speech）与语气（tone）时，该角色的对话 MUST 体现其语癖与语气")
  })

  test("规则 20 人物一致性要求言行符合档案个性、外貌不与身体特征冲突", () => {
    expect(prompt).toContain("言行举止必须符合档案个性")
    expect(prompt).toContain("外貌描写不得与档案身体特征冲突")
  })
})

describe("auditor 档案对照指示（character-profile-audit）", () => {
  const prompt = auditorAgent.prompt

  test("前置动作声明档案维度行是角色对照权威来源", () => {
    expect(prompt).toContain("是角色外貌与言行对照的**权威来源**")
    expect(prompt).toContain("档案非空的角色必须以档案逐维度对照正文")
  })

  test("维度 2 外貌描述引用档案 appearance 并给出 FAIL 判定规则", () => {
    expect(prompt).toContain("**档案 appearance 非空时**")
    expect(prompt).toContain("部位/方位冲突（如档案写左脸旧疤、正文写右脸）→ **直接 FAIL**")
    expect(prompt).toContain("台词内角色的转述性提及不算矛盾")
  })

  test("维度 3 性格一致引用档案 speech/tone/personality 且动态情绪不算违规", () => {
    expect(prompt).toContain("**档案 speech/tone/personality 非空时**")
    expect(prompt).toContain("对话必须体现档案说话习惯与语气")
    expect(prompt).toContain("角色动态情绪变化（章节间 mood 演进）不算档案违规")
  })

  test("轻量模式维度子集含角色连续性，档案对照指示随之生效", () => {
    expect(prompt).toContain("+ 维度 1-5（角色连续性 5 维）")
  })
})
