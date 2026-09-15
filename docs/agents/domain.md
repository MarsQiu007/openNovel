# Domain Docs

工程技能在探索代码库前应如何消费本仓库的领域文档。

## Before exploring, read these

- 根目录的 **`CONTEXT.md`**；
- 若存在根目录 **`CONTEXT-MAP.md`**，按映射读取与主题相关的各 context `CONTEXT.md`；
- **`docs/adr/`** 中触及目标区域的 ADR。

如果某个文件不存在，**静默继续**。不要提示缺失，也不要预先建议创建。`/domain-modeling`（通过 `/grill-with-docs` 或 `/improve-codebase-architecture` 进入）会在术语或决策实际被解决时惰性创建这些文件。

## File structure

本仓库当前采用 single-context：

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

后续若引入 `CONTEXT-MAP.md`，则切换为 multi-context：系统级 ADR 放在根目录 `docs/adr/`，context 专属文档和 ADR 放在对应 context 目录中。

## Use the glossary's vocabulary

当输出中出现领域概念（issue 标题、重构提案、假设、测试名等）时，使用 `CONTEXT.md` 中定义的术语，避免使用术语表明确排除的同义词。

如果所需概念还没有进入术语表，这表示你可能在发明项目不使用的语言，或者存在真实的文档缺口。先重新斟酌命名；确认是缺口时留给 `/domain-modeling` 处理。

## Flag ADR conflicts

如果输出与既有 ADR 矛盾，不要静默覆盖；必须显式指出矛盾并说明是否值得重新讨论。
