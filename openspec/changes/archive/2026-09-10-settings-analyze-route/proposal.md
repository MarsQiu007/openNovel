## Why

用户说"分析设定"时，director 将其路由到 check_novel_settings + check_relationships 的评析路径（LLM 通读后产出主观分析结论），不会触发 lint_settings 的确定性结构扫描。评析报告中的"合并重复条目"等可操作结论没有经过机器扫描验证，后续要落地修改时缺少 lint_settings 产出的结构问题清单作为入口。需要在评析路径中补调 lint_settings，合并两个视角的发现，使分析报告天然包含可执行问题清单。

## What Changes

- 在 director system prompt 的路由规则中新增"分析设定"分支：同时调用 lint_settings 获取机器检测的结构化问题（非标准分类、空字段、跨分类同标题），再调用 check_novel_settings 拉取全量概览供 LLM 评析。
- 报告中区分"结构问题"（lint_settings 检出，可直接用 rename_world_category / update_setting 修复）和"内容问题"（LLM 评析发现，需进一步确认），分别标注来源。
- 不修改 lint_settings、check_novel_settings 或 check_relationships 的工具实现，仅调整 director 提示词路由。

### 非目标

- 不新增工具或修改任何工具的 execute 逻辑。
- 不自动将 LLM 评析结论转为修改指令或自动执行修复。
- 不改变"整理设定"的触发条件和流程。

## Capabilities

### Modified Capabilities

- setting-agent-tools: 补充"分析设定"场景的路由约束，要求同时调用确定性扫描和评析拉取，并在报告中区分问题来源。

## Impact

- packages/plugin: 更新 director agent system prompt 中的路由规则。
