/**
 * /evaluate 模板命令注册（design D4.1）
 *
 * 经插件 V2 command 域（CommandHooks transform）注册为带 agent 的模板命令：
 * 模板把 $ARGUMENTS（范围参数原文）交给 director，由它调用 evaluate 插件工具
 * 生成报告并把内容贴回会话（报告正文始终落盘，会话里只放报告内容与路径）。
 * 命令注册挂在 `.novel/` 存在的条件分支内（非小说目录零污染，同上下文源）。
 */
import type { CommandDraft } from "../../v2/effect/command.js"

const TEMPLATE = `用户触发了创作自评价命令 /evaluate。请生成项目创作自评价报告并向用户汇报。

范围参数（用户输入的命令参数原文）：$ARGUMENTS
- 留空 = 上次报告以来（默认）
- volume = 当前卷
- sessions N = 最近 N 个会话（如 "sessions 5"，N 默认 5）
- all = 全部历史

执行步骤：
1. 调用 evaluate 工具：scope 按上述参数取值（since-last/volume/sessions/all），sessions 时一并传 count
2. 工具返回报告全文与落盘路径后，把报告内容原样贴回会话，并附报告文件路径
3. 本命令只读指标桶并生成报告，不要修改任何写作数据，也不要对报告结论做额外发挥——逐条原样呈现 A/B/C 三部分即可`

export function registerEvaluateCommand(draft: CommandDraft) {
  draft.update("evaluate", (item) => {
    item.template = TEMPLATE
    item.description =
      "生成创作自评价报告（A 创作复盘 / B 配置优化建议 / C 产品信号），报告落盘 .novel/evaluate/ 并贴回会话。范围：空=上次报告以来，volume=本卷，sessions N=最近 N 会话，all=全部"
    item.agent = "director"
  })
}
