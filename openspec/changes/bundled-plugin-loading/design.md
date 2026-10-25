# Design：构建期打包第一方插件

## D1：装载入口——构建映射优先，import.meta.resolve 回退

`external.ts` 的 `resolveHostEntry(pkg)` 当前直接 `import.meta.resolve(pkg)`。改为两级：

1. **构建映射命中** → 返回 `new URL(chunkPath, import.meta.url).href`（chunk 与 node.js 同 outdir，纯 Node 可加载的 ESM js）；
2. **未命中**（bun 直跑、测试、第三方构建）→ 回退 `import.meta.resolve`。

映射经 Bun.build `define` 注入为编译期常量，核心运行时判空用 `typeof OPENNOVEL_BUNDLED_PLUGINS === "undefined"`（沿用 `models-dev.ts` 的 `OPENNOVEL_MODELS_DEV` 先例），无注入环境零行为变化。映射查找抽为导出纯函数 `bundledEntry(pkg, baseHref)` 便于单测。

## D2：共享 chunk 保证模块单例

插件 wrapper 作为**附加 entrypoint** 进入 `build-node.ts` 的 `Bun.build`：

- 需显式开启 `splitting: true`（当前单 entrypoint 未开）；开启后 workspace 模块（core/effect/Context Tag）自动拆为共享 chunk，宿主与插件引用同一实例；关闭 splitting 会让插件 chunk 内联各自副本——**Context 双实例会直接破坏服务注入，必须开启**。
- 既有 `build.ts`（bun 编译二进制）不开 splitting 也不用本机制：其运行时自带 TS 装载能力，维持 `import.meta.resolve` 回退，避免未验证的编译产物内 chunk 导入路径（bunfs 虚拟文件）风险。

wrapper 为薄转出口（`export { default }`），不改变插件模块形状；装载器的 `PluginModule` 解码仍取 `.default`。

## D3：映射清单的唯一来源

`script/bundled-plugins.ts` 导出构建期清单，`build-node.ts` 消费，避免映射与 entrypoint 列表漂移：

```ts
export const bundledPlugins = {
  // 包 id → wrapper 源路径（entrypoint）与 chunk 相对输出路径
  "@opennovel-ai/plugin/novel-writer-v2": {
    wrapper: "./src/plugin-bundle/novel-writer-v2.ts",
    chunk: "./plugin-bundle/novel-writer-v2.js",
  },
} as const
```

`define` 值取 `{ 包 id: chunk }` 的 JSON 串。新增第一方可配置插件时只改这一处。

## D4：不影响面

- registry（npm 第三方）插件仍走 `npm.add`，不经构建映射；
- 文件路径/绝对路径插件的解析不变；
- 同步/异步装载分野（plugin-cutover-repair 确立）不受影响：映射只改 entrypoint 的**解析**，不改装载时机。

## 验证策略

- 单测：`bundledEntry` 命中/未命中/无注入三分支；
- 端到端：`bun script/build-node.ts` 后用**纯 Node** 起服务器（`OPENNOVEL_SERVER_PASSWORD` 固定），带 `plugins` 配置请求 `agent.list`，断言 12 个写作 agent 描述就位、build/plan 缺席、research 在场——复现 sidecar（utility process）运行时。
