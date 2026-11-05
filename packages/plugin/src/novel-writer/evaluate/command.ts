/**
 * /evaluate 模板命令注册（design D4.1）
 *
 * 经插件 V2 command 域（CommandHooks transform）注册为带 agent 的模板命令：
 * 模板把 $ARGUMENTS（范围参数原文）交给 director，由它调用 evaluate 插件工具
 * 生成报告并把内容贴回会话（报告正文始终落盘，会话里只放报告内容与路径）。
 * 命令注册挂在 `.novel/` 存在的条件分支内（非小说目录零污染，同上下文源）。
 */
import type { CommandDraft } from "../../v2/effect/command.js"

const TEMPLATE = `用户触发了创作自评价命令 /evaluate。请按参数生成自评价产物并向用户汇报。

参数（用户输入的命令参数原文）：$ARGUMENTS
报告范围（默认子命令）：
- 留空 = 上次报告以来（默认）
- volume = 当前卷
- sessions N = 最近 N 个会话（如 "sessions 5"，N 默认 5）
- all = 全部历史
诊断包导出子命令：
- export [--level L0|L1|L2] = 导出诊断包（默认 L1）：L0 纯计数 / L1 +脱敏错误分类样本（不含正文与题材值）/ L2 +复现事件序列

执行步骤：
1. 参数以 export 开头时：调用 evaluate 工具 action="export"，level 按 --level 取值（缺省 L1）；否则调用 evaluate 工具生成报告，scope 按上述范围参数取值（since-last/volume/sessions/all），sessions 时一并传 count
2. 报告：把报告内容原样贴回会话并附落盘路径；导出：贴回诊断包路径与分级说明
3. 导出级别为 L2 时必须向用户提示：诊断包含复现事件序列，可能含题材相关信息，分享前请自行检查
4. 本命令只读指标桶，不要修改任何写作数据，也不要对产物内容做额外发挥——报告逐条原样呈现 A/B/C 三部分，导出原样呈现分级说明`

export function registerEvaluateCommand(draft: CommandDraft) {
  draft.update("evaluate", (item) => {
    item.template = TEMPLATE
    item.description =
      "生成创作自评价报告（A 创作复盘 / B 配置优化建议 / C 产品信号），报告落盘 .novel/evaluate/ 并贴回会话；export 子命令导出分级诊断包（L0 计数/L1 脱敏样本/L2 复现序列）。范围：空=上次报告以来，volume=本卷，sessions N=最近 N 会话，all=全部"
    item.agent = "director"
  })
}
