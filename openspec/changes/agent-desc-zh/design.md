# Design：三处 description 直译

`packages/core/src/plugin/agent.ts` 第 126、139、159/167 行三处 `item.description = ...` 直译为中文：

- default：「默认智能体。按配置的权限执行工具。」
- plan：「计划模式。禁用所有编辑工具。」
- general：「通用智能体，用于研究复杂问题并执行多步任务。可用此智能体并行执行多个工作单元。」
- explore：「快速代码库探索专用智能体。需要通过模式找文件（如 src/components/**/*.tsx）、按关键词搜代码（如 API endpoints）、或回答代码库相关问题时使用。调用时指定 thoroughness 级别：quick 基本搜索 / medium 中等探索 / very thorough 跨多位置与命名约定的全面分析。」

`PROMPT_*` 常量与 `BUILD_SYSTEM` 保留英文（模型指令，不出现在面板）。
