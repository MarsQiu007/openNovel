# Tasks: settings-tree-visual-hierarchy

## 1. 图标资源

- [x] 1.1 在 `packages/ui/src/components/icon.tsx`（`@opennovel-ai/ui/icon` 注册表）新增 6 个语义图标：`book` / `map` / `zap` / `fire` / `library` / `user`（按 D3 规格，20×20 viewBox、stroke currentColor、`stroke-linecap="square"`；`book` 借 v2 形状走 16×16 特判先例），复用已有 `chevron-right` / `chevron-down` / `folder` / `pencil-line` / `checklist` / `brain`。验证：`packages/ui` 下 `bun typecheck` 通过，Storybook 或临时页面可见全部新图标

## 2. 设定树行结构重构（packages/app）

- [x] 2.1 重构 `settings-tree.tsx` 三个行组件为「引导线槽 + 控件列 + 图标列 + 文本」三段式：可收纳节点 chevron + 语义图标、叶子节点图标占父级 chevron 同列（VS Code 式，D2）、缩进阶梯 12px→16px 由槽撑出（depth 语义不变，一级节点对齐修正）。硬约束：保留 `data-slot="settings-tree"` 容器与树内节点按钮的 role/可见文本（e2e 探针按此定位）。验证：`packages/app` 下 `bun typecheck` 通过，同层级行控件列起点一致
- [x] 2.2 实现逐级引导线（D1：相对定位容器 + 绝对定位 1px 竖线，位置由 depth 推导，token 取最浅 border 系）。验证：展开「世界观条目 > 某分类 > 条目」三层后，条目行存在与分类连接的可见引导线
- [x] 2.3 选中/悬停状态分离（D4：选中 = accent 左侧 2px 指示条 + 微色块；悬停 = 浅灰），板块头与分类组按 D6 去 uppercase 改字重分层；保留 badge、faded、搜索展开、新建入口行为不变。验证：选中 A 悬停 B 时两者外观可区分；搜索过滤、收纳切换、待办徽标、退场角色灰显行为与改动前一致
- [x] 2.4 确认既有测试不受行结构重构影响：`settings-node.test.ts` 只覆盖 `settings-node.ts` 纯函数（已核实）；e2e 探针按 `data-slot` 容器 + 节点按钮可访问名称定位（已核实），重构保留锚点即可。验证：`packages/app` 下 `bun test` 相关套件通过

## 3. 验收

- [ ] 3.1 深浅色两主题下目测验收层级可读性（引导线、图标、状态分离在两主题均成立；滚动到深层条目区仍可辨归属）。验收为像素级 UI 目测，交用户执行
- [x] 3.2 对照 delta spec「设定树层级可视化」四条 scenario 逐条核对实现。验证：scenario 与实现一致，`openspec validate settings-tree-visual-hierarchy --strict` 通过

## Workflow follow-up

- 实现完成后：勾选任务、收集实现提交写入 `## Implementation Commits`、`openspec validate --strict`、归档并合并
- 纯展示层变更（无协议/生成物），无需 `bun run generate` 与旧 SDK 再生
