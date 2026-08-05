---
kind: logging_system
name: 日志系统（Effect Logger + electron-log + OTLP）
category: logging_system
scope:
    - '**'
source_files:
    - packages/core/src/observability/logging.ts
    - packages/core/src/observability/otlp.ts
    - packages/core/src/observability.ts
    - packages/desktop/src/main/logging.ts
    - packages/console/app/src/routes/zen/util/logger.ts
    - packages/console/core/src/util/log.ts
    - packages/opencode/src/index.ts
---

## 1. 使用的系统与框架
- **Node/CLI/Web 核心**：基于 Effect 的 `Logger` 与 `Formatter`，通过 `Logger.layer` 组合多个 sink（文件、stderr、OTLP），统一输出结构化日志。
- **Electron 桌面端**：使用 `electron-log`（`MainLogger`）作为主进程/渲染进程日志记录器，并配合 Electron 原生 `crashReporter`、`netLog` 收集崩溃与网络日志。
- **Console 子应用**：在 `packages/console/app` 中使用极简 `logger` 对象直接调用 `console.log/debug`，并在生产环境屏蔽 debug。
- **OpenTelemetry / OTLP**：通过 `effect/unstable/observability` 的 `OtlpLogger` 将日志与追踪上报到 OTLP 接收端。

## 2. 关键文件与包
- `packages/core/src/observability/logging.ts` — Effect Logger 的结构化格式化、文件/标准错误输出、最小日志级别解析。
- `packages/core/src/observability/otlp.ts` — OTLP 日志与追踪层配置（endpoint、headers、resource attributes）。
- `packages/core/src/observability.ts` — 将 Logging 与 Otlp 合并为统一的 Observability Layer，注入 `References.MinimumLogLevel`。
- `packages/desktop/src/main/logging.ts` — Electron 日志初始化、按 run 目录拆分、控制台传输、调试日志导出 zip、崩溃报告与网络日志。
- `packages/console/app/src/routes/zen/util/logger.ts` — Console 应用的轻量 logger（metric/log/debug）。
- `packages/console/core/src/util/log.ts` — Console Core 的 Tagged Log 上下文（Context 提供 tags 前缀）。
- `packages/opencode/src/index.ts`、`packages/opencode/src/temporary.ts` — CLI 入口将 `--printLogs`、`--logLevel` 映射为环境变量。

## 3. 架构与约定
- **分层组合**：`Observability.layer` 通过 `Logger.layer([...Logging.loggers(), ...Otlp.loggers()], { mergeWithExisting: false })` 把文件日志、可选 stderr 日志与 OTLP 日志 sink 组合起来，再提供 NodeFileSystem、OTLP JSON 序列化与 HTTP 客户端依赖。
- **结构化格式**：`formatter` 基于 `Logger.formatStructured`，将 timestamp、level、runID、message、cause、spans、annotations 扁平化为 `key=value` 形式；纯对象会被递归展平，循环引用标记为 `[Circular]`，非字符串值经 `Formatter.format` 后再做安全转义或 JSON.stringify。
- **运行标识**：每个 run 通过 `runID` 注入到日志中，便于跨文件/进程关联同一执行。
- **日志级别策略**：通过环境变量 `OPENCODE_LOG_LEVEL` 控制最小级别（DEBUG/INFO/WARN/ERROR），默认 INFO；`OPENCODE_PRINT_LOGS=1` 时额外输出到 stderr。
- **文件输出路径**：默认写入 `Global.Path.log/opennovel.log`，追加模式；Desktop 端则按 run 时间戳创建独立目录，并按 scope（main/renderer/server）拆分为多文件，支持 7 天自动清理。
- **OTLP 上报**：当设置 `OTEL_EXPORTER_OTLP_ENDPOINT` 时启用，同时读取 `OTEL_EXPORTER_OTLP_HEADERS` 与 `OTEL_RESOURCE_ATTRIBUTES`，资源属性包含 service name/version、deployment environment、client 标识与 runID。
- **Electron 特殊处理**：`initLogging` 初始化 electron-log 的文件 transport、console spy、崩溃报告、网络日志；提供 `exportDebugLogs` 打包 manifest、desktop/server/crashpad/netlog 等日志为 zip 并打开下载文件夹；console transport 捕获 EPIPE 异常后降级关闭。

## 4. 约定与约束
- **日志字段规范**：所有 Effect 日志必须遵循 `timestamp=... level=... run=... message=...` 等 key=value 结构，由 `formatter` 强制生成。
- **级别开关**：仅允许 DEBUG/INFO/WARN/ERROR 四个级别，其他值回退为 INFO；是否打印 stderr 由 `OPENCODE_PRINT_LOGS` 决定。
- **运行时注入**：日志层通过 Effect Layer 注入，消费方应通过 `Observability.node` 或 `Observability.layer` 提供，避免直接使用全局 console。
- **Desktop 日志生命周期**：每次启动创建新 run 目录，超过 7 天的日志自动删除；导出功能限制单文件 50MB、只保留最近 24 小时内的日志。
- **Console 应用开发期调试**：`logger.debug` 在非 production stage 下才输出，生产环境静默。
- **OTLP 条件启用**：未设置 endpoint 时不启用 OTLP logger/tracing layer，避免无意义的网络开销。
