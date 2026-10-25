# bundled-plugin-loading：构建期打包第一方插件，修复桌面端装载

## 背景

V1→V2 cutover 后，novel-writer V2 插件经配置的 `plugins` 条目由外部插件装载器（`core/src/config/plugin/external.ts`）动态装载：第一方包（`@opennovel-ai/*`）经 `import.meta.resolve` 解析到 workspace **TypeScript 源码**后 `import()`。

在 bun 直接运行的环境（CLI、测试、httpapi 练习）中该路径工作正常；但**桌面端 sidecar 在 Electron utility process（纯 Node.js）中运行打包产物** `opennovel/dist/node/node.js`，Node 无法加载 `.ts` 文件（`ERR_MODULE_NOT_FOUND`），装载被 `logWarning + ignoreCause` 静默吞掉。结果是桌面 app 中 novel-writer 全家（12 个写作 agent、88 个工具、上下文源）从未真正装载——智能体面板只显示内置 agent 与配置 `agent` 段按模型覆盖创建的空壳（无描述、无 mode、无 system，build/plan 未被移除、无 research）。

这是 V1 静态装配退出后暴露的装载环境缺口：第一方插件的动态 TS 装载在非 bun 运行时必然失败。

## 目标

让第一方外部插件在**构建产物环境**（桌面 sidecar / 编译二进制，纯 Node）中与 bun 环境同等可用，且保持：

- **模块单例**：插件与宿主 bundle 共享 `effect`、core Schema、Context Tag 等模块实例（Context 身份按引用比较，双副本会直接破坏 `ctx.agent.transform` 等服务注入）；
- **bun 直跑兼容**：`bun src/index.ts`、测试等无 define 注入的环境行为不变（回退 `import.meta.resolve`）；
- **装载语义不变**：同步/异步分野、失败兜底（logWarning + ignoreCause）、重定向表均不受影响。

## 方案概要

1. `packages/opennovel/src/plugin-bundle/novel-writer-v2.ts` 增加薄 wrapper entrypoint（`export { default } from "@opennovel-ai/plugin/novel-writer-v2"`）；
2. `script/build-node.ts` 把 wrapper 作为附加 entrypoint 打入同一 outdir（`splitting: true`，共享 chunk），并以 `define` 注入映射 `OPENNOVEL_BUNDLED_PLUGINS: Record<包 id, chunk 相对路径>`；
3. `external.ts` 的 `resolveHostEntry` 先查构建映射（命中则按 `import.meta.url` 拼 chunk 文件 URL），未命中回退 `import.meta.resolve`；
4. 单测覆盖映射查找的纯函数行为。

## 非目标

- 不重排 boot 批顺序、不改动同步/异步装载分野；
- 不改变 registry（npm）第三方插件的装载路径；
- 不预构建 `packages/plugin/dist`（wrapper + 共享 chunk 是唯一打包形态）；
- 编译二进制构建（`script/build.ts`，bun 运行时，回退路径本就可加载 TS 源码）不在本变更范围，行为保持不变。
