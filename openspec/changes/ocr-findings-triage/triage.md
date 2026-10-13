# Triage: ocr-findings-triage

数据来源：ocr scan 会话 dca30d33-f6e3-476c-944a-368ed334ce6e（2026-10-12，model glm-5）。

处置枚举：fix（修复）/ wontfix（误报或冲突仓库约定，附证据）/ defer（真实但不在本 change）。

| ID | 文件:行 | 级别 | 类别 | 处置 | 理由 |
|---|---|---|---|---|---|
| H363 | packages/core/drizzle.config.ts:7 | high | maintainability |  |  |
| H112 | packages/core/package.json:13 | high | bug |  |  |
| H365 | packages/core/src/account/sql.ts:10 | high | security |  |  |
| C121 | packages/core/src/aisdk.ts:99 | critical | bug |  |  |
| H375 | packages/core/src/background-job.ts:256 | high | bug |  |  |
| C124 | packages/core/src/background-job.ts:303 | critical | bug |  |  |
| H374 | packages/core/src/background-job.ts:337 | high | bug |  |  |
| H367 | packages/core/src/command.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H368 | packages/core/src/config.ts:177 | high | bug |  |  |
| H369 | packages/core/src/config.ts:196 | high | bug |  |  |
| H370 | packages/core/src/config.ts:200 | high | bug |  |  |
| H366 | packages/core/src/config/attachments.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C120 | packages/core/src/config/command.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C122 | packages/core/src/config/compaction.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C123 | packages/core/src/config/lsp.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H373 | packages/core/src/config/markdown.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H371 | packages/core/src/config/mcp.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H372 | packages/core/src/config/plugin.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H376 | packages/core/src/config/plugin/external.ts:87 | high | maintainability |  |  |
| H384 | packages/core/src/config/plugin/provider.ts:26 | high | bug |  |  |
| H379 | packages/core/src/config/plugin/reference.ts:41 | high | bug |  |  |
| H377 | packages/core/src/config/plugin/skill.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C127 | packages/core/src/config/tool-output.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H383 | packages/core/src/control-plane/move-session.ts:93 | high | bug |  |  |
| H382 | packages/core/src/control-plane/move-session.ts:106 | high | bug |  |  |
| H378 | packages/core/src/control-plane/workspace.sql.ts:17 | high | bug |  |  |
| H380 | packages/core/src/credential.ts:37 | high | maintainability |  |  |
| C126 | packages/core/src/credential.ts:56 | critical | bug |  |  |
| C125 | packages/core/src/credential.ts:124 | critical | bug |  |  |
| H381 | packages/core/src/credential/sql.ts:9 | high | security |  |  |
| H387 | packages/core/src/database/database.ts:43 | high | security |  |  |
| H385 | packages/core/src/database/migration/20260211171708_add_project_commands.ts:4 | high | maintainability |  |  |
| C128 | packages/core/src/database/migration/20260227213759_add_session_workspace_id.ts:4 | critical | maintainability |  |  |
| H386 | packages/core/src/database/migration/20260227213759_add_session_workspace_id.ts:8 | high | bug |  |  |
| H388 | packages/core/src/database/migration/20260303231226_add_workspace_fields.ts:4 | high | maintainability |  |  |
| C129 | packages/core/src/database/migration/20260303231226_add_workspace_fields.ts:8 | critical | bug |  |  |
| H389 | packages/core/src/database/migration/20260303231226_add_workspace_fields.ts:12 | high | bug |  |  |
| C130 | packages/core/src/database/migration/20260309230000_move_org_to_state.ts:4 | critical | bug |  |  |
| H390 | packages/core/src/database/migration/20260309230000_move_org_to_state.ts:9 | high | bug |  |  |
| C131 | packages/core/src/database/migration/20260312043431_session_message_cursor.ts:? | critical | maintainability |  |  |
| C132 | packages/core/src/database/migration/20260312043431_session_message_cursor.ts:? | critical | bug |  |  |
| H391 | packages/core/src/database/migration/20260312043431_session_message_cursor.ts:? | high | performance |  |  |
| H392 | packages/core/src/database/migration/20260323234822_events.ts:14 | high | bug |  |  |
| H394 | packages/core/src/database/migration/20260427172553_slow_nightmare.ts:27 | high | bug |  |  |
| C133 | packages/core/src/database/migration/20260428004200_add_session_path.ts:4 | critical | maintainability |  |  |
| H393 | packages/core/src/database/migration/20260507164347_add_workspace_time.ts:4 | high | maintainability |  |  |
| H396 | packages/core/src/database/migration/20260510033149_session_usage.ts:4 | high | maintainability |  |  |
| H397 | packages/core/src/database/migration/20260511000411_data_migration_state.ts:? | high | maintainability |  |  |
| C136 | packages/core/src/database/migration/20260601010001_normalize_storage_paths.ts:11 | critical | bug |  |  |
| C134 | packages/core/src/database/migration/20260601202201_amazing_prowler.ts:4 | critical | maintainability |  |  |
| H395 | packages/core/src/database/migration/20260601202201_amazing_prowler.ts:8 | high | bug |  |  |
| H399 | packages/core/src/database/migration/20260602182828_add_project_directories.ts:4 | high | maintainability |  |  |
| H400 | packages/core/src/database/migration/20260603001617_session_message_projection_indexes.ts:4 | high | maintainability |  |  |
| C135 | packages/core/src/database/migration/20260603040000_session_message_projection_order.ts:4 | critical | maintainability |  |  |
| H398 | packages/core/src/database/migration/20260603040000_session_message_projection_order.ts:10 | high | maintainability |  |  |
| C137 | packages/core/src/database/migration/20260603160727_jittery_ezekiel_stane.ts:4 | critical | maintainability |  |  |
| C138 | packages/core/src/database/migration/20260605003541_add_session_context_snapshot.ts:? | critical | maintainability |  |  |
| H401 | packages/core/src/database/migration/20260611035744_credential.ts:? | high | security |  |  |
| H402 | packages/core/src/database/migration/20260611192811_lush_chimera.ts:4 | high | maintainability |  |  |
| C139 | packages/core/src/database/migration/20260611192811_lush_chimera.ts:9 | critical | bug |  |  |
| C140 | packages/core/src/database/migration/20260622142730_simplify_session_context_epoch.ts:4 | critical | maintainability |  |  |
| H403 | packages/core/src/database/migration/20260622142730_simplify_session_context_epoch.ts:8 | high | maintainability |  |  |
| C145 | packages/core/src/database/migration/20260622202450_simplify_session_input.ts:4 | critical | bug |  |  |
| C142 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:? | critical | bug |  |  |
| C143 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:? | critical | bug |  |  |
| H405 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:? | high | bug |  |  |
| H406 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:? | high | bug |  |  |
| H404 | packages/core/src/database/migration/20260721152252_novel_writing_tables.ts:4 | high | maintainability |  |  |
| C141 | packages/core/src/database/migration/20261010032350_global_novels_columns.ts:4 | critical | maintainability |  |  |
| C144 | packages/core/src/database/path.ts:? | critical | bug |  |  |
| H408 | packages/core/src/database/sqlite.bun.ts:111 | high | security |  |  |
| H407 | packages/core/src/database/sqlite.bun.ts:123 | high | bug |  |  |
| H411 | packages/core/src/database/sqlite.node.ts:23 | high | security |  |  |
| H409 | packages/core/src/database/sqlite.node.ts:58 | high | bug |  |  |
| H410 | packages/core/src/database/sqlite.node.ts:71 | high | bug |  |  |
| H415 | packages/core/src/effect/layer-node.ts:259 | high | bug |  |  |
| H412 | packages/core/src/effect/runtime.ts:6 | high | bug |  |  |
| H413 | packages/core/src/effect/runtime.ts:12 | high | bug |  |  |
| C147 | packages/core/src/event.ts:316 | critical | bug |  |  |
| H417 | packages/core/src/event.ts:354 | high | bug |  |  |
| H418 | packages/core/src/event.ts:441 | high | bug |  |  |
| C148 | packages/core/src/event.ts:585 | critical | bug |  |  |
| H414 | packages/core/src/event/sql.ts:14 | high | maintainability |  |  |
| C146 | packages/core/src/filesystem/search.ts:30 | critical | bug |  |  |
| H416 | packages/core/src/filesystem/search.ts:151 | high | bug |  |  |
| H420 | packages/core/src/filesystem/watcher.ts:86 | high | bug |  |  |
| H421 | packages/core/src/filesystem/watcher.ts:94 | high | bug |  |  |
| H419 | packages/core/src/flag/flag.ts:32 | high | security |  |  |
| H427 | packages/core/src/git.ts:181 | high | bug |  |  |
| H428 | packages/core/src/git.ts:731 | high | bug |  |  |
| H422 | packages/core/src/github-copilot/chat/convert-to-openai-compatible-chat-messages.ts:41 | high | bug |  |  |
| H423 | packages/core/src/github-copilot/chat/convert-to-openai-compatible-chat-messages.ts:135 | high | bug |  |  |
| H424 | packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts:480 | high | bug |  |  |
| H425 | packages/core/src/github-copilot/chat/openai-compatible-chat-language-model.ts:537 | high | bug |  |  |
| C149 | packages/core/src/github-copilot/chat/openai-compatible-prepare-tools.ts:67 | critical | bug |  |  |
| H429 | packages/core/src/github-copilot/responses/convert-to-openai-responses-input.ts:142 | high | bug |  |  |
| H426 | packages/core/src/github-copilot/responses/openai-responses-api-types.ts:34 | high | bug |  |  |
| H431 | packages/core/src/github-copilot/responses/tool/file-search.ts:125 | high | bug |  |  |
| H430 | packages/core/src/github-copilot/responses/tool/image-generation.ts:95 | high | bug |  |  |
| H433 | packages/core/src/global.ts:11 | high | bug |  |  |
| H432 | packages/core/src/id/id.ts:39 | high | bug |  |  |
| H434 | packages/core/src/image/photon.ts:? | high | maintainability |  |  |
| H435 | packages/core/src/integration.ts:322 | high | bug |  |  |
| C150 | packages/core/src/integration/connection.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H436 | packages/core/src/models-dev.ts:255 | high | bug |  |  |
| C151 | packages/core/src/models-dev.ts:256 | critical | bug |  |  |
| H437 | packages/core/src/npm-config.ts:32 | high | bug |  |  |
| H438 | packages/core/src/npm.ts:45 | high | security |  |  |
| C152 | packages/core/src/oauth/page.ts:114 | critical | security |  |  |
| H439 | packages/core/src/patch.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H440 | packages/core/src/patch.ts:160 | high | bug |  |  |
| C154 | packages/core/src/permission.ts:237 | critical | bug |  |  |
| H443 | packages/core/src/permission.ts:250 | high | bug |  |  |
| C153 | packages/core/src/permission/saved.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H441 | packages/core/src/permission/saved.ts:47 | high | maintainability |  |  |
| H442 | packages/core/src/permission/saved.ts:67 | high | maintainability |  |  |
| H444 | packages/core/src/plugin.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C155 | packages/core/src/plugin.ts:128 | critical | bug |  |  |
| H446 | packages/core/src/plugin/command.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H445 | packages/core/src/plugin/host.ts:201 | high | bug |  |  |
| H449 | packages/core/src/plugin/internal.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H447 | packages/core/src/plugin/promise.ts:29 | high | bug |  |  |
| H448 | packages/core/src/plugin/promise.ts:69 | high | bug |  |  |
| H450 | packages/core/src/plugin/provider/amazon-bedrock.ts:90 | high | bug |  |  |
| H455 | packages/core/src/plugin/provider/cloudflare-workers-ai.ts:17 | high | bug |  |  |
| H454 | packages/core/src/plugin/provider/dynamic.ts:14 | high | security |  |  |
| C156 | packages/core/src/plugin/provider/github-copilot.ts:? | critical | bug |  |  |
| H456 | packages/core/src/plugin/provider/gitlab.ts:41 | high | bug |  |  |
| H453 | packages/core/src/plugin/provider/google-vertex.ts:44 | high | bug |  |  |
| H452 | packages/core/src/plugin/provider/google-vertex.ts:45 | high | performance |  |  |
| H451 | packages/core/src/plugin/provider/google-vertex.ts:48 | high | bug |  |  |
| H457 | packages/core/src/plugin/provider/nvidia.ts:10 | high | bug |  |  |
| H458 | packages/core/src/plugin/provider/nvidia.ts:13 | high | bug |  |  |
| H459 | packages/core/src/plugin/provider/openai.ts:114 | high | bug |  |  |
| C157 | packages/core/src/plugin/provider/opennovel.ts:239 | critical | bug |  |  |
| H460 | packages/core/src/plugin/provider/sap-ai-core.ts:? | high | bug |  |  |
| H461 | packages/core/src/plugin/provider/vercel.ts:9 | high | bug |  |  |
| H462 | packages/core/src/policy.ts:35 | high | bug |  |  |
| C158 | packages/core/src/process.ts:202 | critical | bug |  |  |
| C161 | packages/core/src/project/copy.ts:175 | critical | bug |  |  |
| H465 | packages/core/src/project/copy.ts:217 | high | performance |  |  |
| C160 | packages/core/src/project/copy.ts:244 | critical | bug |  |  |
| H463 | packages/core/src/project/schema.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H464 | packages/core/src/provider.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H468 | packages/core/src/pty.ts:109 | high | maintainability |  |  |
| C164 | packages/core/src/pty.ts:204 | critical | bug |  |  |
| H469 | packages/core/src/pty.ts:223 | high | bug |  |  |
| H470 | packages/core/src/pty.ts:286 | high | bug |  |  |
| C159 | packages/core/src/pty/protocol.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C162 | packages/core/src/public-event-manifest.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H467 | packages/core/src/reference.ts:88 | high | bug |  |  |
| H466 | packages/core/src/reference.ts:109 | high | bug |  |  |
| C163 | packages/core/src/repository.ts:168 | critical | security |  |  |
| H480 | packages/core/src/ripgrep.ts:116 | high | bug |  |  |
| C167 | packages/core/src/ripgrep/binary.ts:58 | critical | security |  |  |
| H474 | packages/core/src/schema.ts:? | high | bug |  |  |
| C165 | packages/core/src/session.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C166 | packages/core/src/session.ts:374 | critical | bug |  |  |
| H473 | packages/core/src/session/context-epoch.ts:40 | high | bug |  |  |
| H471 | packages/core/src/session/context-epoch.ts:80 | high | bug |  |  |
| H472 | packages/core/src/session/context-epoch.ts:122 | high | bug |  |  |
| H475 | packages/core/src/session/execution/local.ts:21 | high | bug |  |  |
| H477 | packages/core/src/session/input.ts:51 | high | bug |  |  |
| H476 | packages/core/src/session/input.ts:129 | high | bug |  |  |
| H478 | packages/core/src/session/message-updater.ts:334 | high | bug |  |  |
| C168 | packages/core/src/session/message.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H479 | packages/core/src/session/projector.ts:312 | high | bug |  |  |
| H481 | packages/core/src/session/run-coordinator.ts:37 | high | bug |  |  |
| C169 | packages/core/src/session/runner/publish-llm-event.ts:46 | critical | bug |  |  |
| H483 | packages/core/src/session/store.ts:36 | high | bug |  |  |
| H484 | packages/core/src/session/store.ts:55 | high | bug |  |  |
| H482 | packages/core/src/share/sql.ts:10 | high | security |  |  |
| H485 | packages/core/src/skill.ts:79 | high | security |  |  |
| H495 | packages/core/src/state.ts:33 | high | bug |  |  |
| H486 | packages/core/src/sync/device.ts:? | high | bug |  |  |
| C170 | packages/core/src/sync/local-folder.ts:15 | critical | security |  |  |
| H492 | packages/core/src/sync/service.ts:578 | high | bug |  |  |
| H489 | packages/core/src/sync/sqlite.bun.ts:10 | high | security |  |  |
| C171 | packages/core/src/sync/sqlite.bun.ts:20 | critical | security |  |  |
| H487 | packages/core/src/sync/sqlite.node.ts:19 | high | security |  |  |
| H488 | packages/core/src/sync/state.ts:36 | high | bug |  |  |
| H490 | packages/core/src/sync/webdav.ts:117 | high | bug |  |  |
| H491 | packages/core/src/system-context/builtins.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H493 | packages/core/src/system-context/index.ts:228 | high | bug |  |  |
| H494 | packages/core/src/system-context/index.ts:314 | high | bug |  |  |
| C172 | packages/core/src/tool-output-store.ts:182 | critical | bug |  |  |
| H498 | packages/core/src/tool/apply-patch.ts:91 | high | bug |  |  |
| H500 | packages/core/src/tool/bash.ts:59 | high | maintainability |  |  |
| C173 | packages/core/src/tool/builtins.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H496 | packages/core/src/tool/glob.ts:75 | high | security |  |  |
| H497 | packages/core/src/tool/question.ts:80 | high | bug |  |  |
| H505 | packages/core/src/tool/read-filesystem.ts:216 | high | bug |  |  |
| H499 | packages/core/src/tool/read.ts:69 | high | security |  |  |
| H502 | packages/core/src/tool/registry.ts:75 | high | bug |  |  |
| H501 | packages/core/src/tool/registry.ts:89 | high | bug |  |  |
| H503 | packages/core/src/tool/tool.ts:98 | high | bug |  |  |
| C174 | packages/core/src/tool/tools.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H504 | packages/core/src/tool/webfetch.ts:85 | high | security |  |  |
| H506 | packages/core/src/tool/websearch.ts:146 | high | security |  |  |
| H510 | packages/core/src/util/effect-flock.ts:263 | high | bug |  |  |
| H511 | packages/core/src/util/flock.ts:213 | high | bug |  |  |
| H507 | packages/core/src/util/hash.ts:4 | high | security |  |  |
| H508 | packages/core/src/util/lazy.ts:5 | high | bug |  |  |
| H509 | packages/core/src/util/retry.ts:27 | high | bug |  |  |
| C175 | packages/core/src/util/token.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H513 | packages/core/src/util/wildcard.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H514 | packages/core/src/util/wildcard.ts:11 | high | bug |  |  |
| C176 | packages/core/src/util/wildcard.ts:13 | critical | bug |  |  |
| H512 | packages/core/src/v1/config/command.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H516 | packages/core/src/v1/config/error.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C177 | packages/core/src/v1/config/layout.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H515 | packages/core/src/v1/config/lsp.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H519 | packages/core/src/v1/config/mcp.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H518 | packages/core/src/v1/config/migrate.ts:30 | high | bug |  |  |
| C178 | packages/core/src/v1/config/permission.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H517 | packages/core/src/v1/config/permission.ts:8 | high | maintainability |  |  |
| H520 | packages/core/src/v1/config/provider-options.ts:98 | high | bug |  |  |
| C179 | packages/core/src/v1/config/provider-options.ts:119 | critical | security |  |  |
| H521 | packages/core/src/v1/config/provider.ts:1 | high | maintainability | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H525 | packages/core/src/v1/config/server.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C183 | packages/core/src/v1/config/skills.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C184 | packages/core/src/v1/config/skills.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H522 | packages/core/src/v1/permission.ts:25 | high | bug |  |  |
| H524 | packages/core/src/v1/session.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C181 | packages/core/src/v2-schema.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C180 | packages/core/src/workspace.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H523 | packages/core/test/fixture/effect-flock-worker.ts:21 | high | bug |  |  |
| C182 | packages/core/test/fixture/flock-worker.ts:37 | critical | bug |  |  |
| H576 | packages/llm/example/tutorial.ts:255 | high | bug | fix | tutorial.ts:230 末尾 Effect.runPromise(program) 无错误处理，示例被复制到生产代码会产生 unhandled rejection；改用 runPromiseExit 或补 .catch 展示惯用错误处理。 |
| H577 | packages/llm/script/recording-cost-report.ts:219 | high | bug | fix | recording-cost-report.ts:219 顶层 await fetch(MODELS_DEV_URL) 无错误处理且未检查 response.ok，网络失败时脚本以未处理拒绝崩溃；按 suggestion 思路包 try/catch 并输出友好错误。 |
| H579 | packages/llm/src/protocols/bedrock-event-stream.ts:41 | high | bug | wontfix | 误报：bedrock-event-stream.ts:34-37 中 totalLength=0 时 subarray(0,0) 为空帧，@smithy/eventstream-codec 对空帧必抛异常并被上方 Effect.try 转为类型化错误，offset 不推进的分支不可达，不存在死循环。 |
| H578 | packages/llm/src/protocols/bedrock-event-stream.ts:59 | high | bug | wontfix | 误报：bedrock-event-stream.ts:12 为 new TextDecoder()（未开 fatal），按 WHATWG 规范非法 UTF-8 字节序列只替换为 U+FFFD，decode 不抛 TypeError。 |
| H581 | packages/llm/src/protocols/shared.ts:165 | high | bug | wontfix | 误报：shared.ts:165 模式含 (?:[A-Za-z0-9+/]{4})* 重复组，无填充的 abcd 可匹配，且 [A-Za-z0-9+/]{3}= 分支可匹配 abc=；外层另有 length%4 校验（shared.ts:191），两条例证均不成立。 |
| H580 | packages/llm/src/protocols/utils/bedrock-media.ts:52 | high | bug | fix | bedrock-media.ts:51 name: part.filename ?? `document.${format}` 在同格式多文档缺文件名时产生重名，模型无法区分引用；缺文件名时用格式+序号生成唯一 name。 |
| H582 | packages/llm/src/providers/azure.ts:? | high | bug | wontfix | 误报（line:0 未定位）：azure.ts:110-114 configuredRoute 的 endpoint.query 已展开 ...(input.apiVersion ? { "api-version": ... } : {}) 与 ...input.queryParams，apiVersion/queryParams 并未被忽略。 |
| C198 | packages/llm/src/providers/cloudflare.ts:48 | critical | bug | wontfix | 刻意设计：cloudflare.ts:48-54 三分支明确——仅传 apiKey 时网关透传 Authorization（无网关鉴权场景），双鉴权需显式传 gatewayApiKey；cloudflare.test.ts:98 的双鉴权用例也是两者都显式传入。 |
| H583 | packages/llm/src/route/auth.ts:138 | high | bug | wontfix | 误报：本仓 Effect 4.0.0-beta.83 中 ConfigError 是 class（effect/src/Config.ts:70 export class ConfigError），instanceof 判断有效；finding 按 Effect 3 联合类型语义误判。 |
| H584 | packages/llm/src/route/client.ts:232 | high | bug | wontfix | 刻意取舍：route/client.ts:235-239 的 eventError 第三参已携带原始 frame（ProviderShared.encodeJson(frame)），错误信息保留完整出错载荷；改用整个 schema 错误树会让流错误冗长。 |
| C199 | packages/llm/src/route/executor.ts:370 | critical | bug | wontfix | 误报：executor.ts:2-9 从 effect/unstable/http 导入 Headers；effect Headers.ts:724 CurrentRedactedNames 是带默认值的 Context.Reference（yield* 合法），executor.test.ts 的 provideService 只是覆盖默认值。 |
| H586 | packages/llm/src/route/transport/websocket.ts:52 | high | bug | wontfix | 误报：websocket.ts:51-56 readyState 检查与 Effect.callback 内的 addEventListener 在同一同步块执行，JS 单线程下 open/close 事件不会在检查与注册之间插入，无 TOCTOU。 |
| H587 | packages/llm/src/route/transport/websocket.ts:125 | high | bug | wontfix | 冲突既定设计：llm 包为服务端包（依赖 @effect/platform-node）；WebSocketExecutor.Service 是可替换接缝（client.ts:422 Effect.serviceOption），构造器强转 WebSocketConstructorWithHeaders 为 ws 类实现预留，浏览器场景由消费方自供实现。 |
| C200 | packages/llm/src/route/transport/websocket.ts:138 | critical | bug | wontfix | 误报：websocket.ts:253-255 frames 内以 Effect.acquireRelease(open, connection.close) 管理连接，中断/超时/作用域退出必定触发 cleanup（removeEventListener + Queue.shutdown + ws.close）。 |
| H585 | packages/llm/src/schema/errors.ts:122 | high | bug | defer | TransportReason.retryable=false（errors.ts:122-129）是逐类显式设计；改为可重试会改变 executor.ts:357-367 retryStatusFailures 的全局重试语义（网络错误是否重试是行为级设计变更），需维护者权衡后再动。 |
| H588 | packages/llm/src/tool.ts:174 | high | bug | wontfix | 已文档化的刻意设计：tool.ts make 的 dynamic 模式注释明确 Inputs are typed as unknown; the handler is responsible for any validation it needs，jsonSchema 仅经 _definition 广告给模型，不做运行时校验。 |
| H589 | packages/llm/test/continuation-scenarios.ts:83 | high | bug | wontfix | 不可达场景：continuation-scenarios.ts:4 toolContinuation=["tool-call","tool-result"] 常量成对使用，全部调用方（anthropic-messages.test.ts:305、openai-responses.test.ts:510）经此常量传 feature，单独 tool-result 不会出现，建议的校验是死代码。 |
| H590 | packages/llm/test/recorded-scenarios.ts:120 | high | bug | wontfix | 测试辅助的断言式缺陷：recorded-scenarios.ts:120 throw 是「工具循环超 10 步」必须响亮失败的用例保护，作为 defect 失败清晰可见；改 Effect.fail 需为所有调用方拓宽错误类型，无实际收益。 |
| H116 | packages/novel-store/package.json:10 | high | maintainability | wontfix | 误报前提：该包不发 npm（script/publish.ts 仅做 CLI/桌面发布，release.yml 只出桌面安装包），exports 指向 src TS 是全仓库惯例（schema/server/core/app/plugin 均如此），且 build:tsc 由包 AGENTS.md 'Build & Verify' 节明确记载为有意保留 |
| C060 | packages/novel-store/package.json:12 | critical | bug | wontfix | 误报前提：包不发布 npm，files:['dist'] 不影响 workspace:* 内消费；exports→./src/index.ts 与 schema/server 等包一致（packages/schema/package.json exports 同为 ./src），改动反而破坏 monorepo 直跑 TS 约定 |
| C061 | packages/novel-store/package.json:15 | critical | bug | wontfix | #driver conditional imports 是 novel-store AGENTS.md 明确记载的跨平台驱动选择机制（'The SQLite driver is selected through the #driver import'），仅 workspace 内消费，premise（npm 发布后缺失文件）不成立 |
| C202 | packages/novel-store/src/approval.ts:54 | critical | bug | fix | 用 db.transaction 同步回调包裹 select+update（参照 packages/novel-store/src/index.ts:2083 promoteWorldMapDraft 的 check-then-act 事务模式），消除审批并发交错窗口 |
| C201 | packages/novel-store/src/driver.bun.ts:12 | critical | bug | fix | init 失败路径用 try/finally 关闭 sqlite 连接（同包 mode.ts writeNovelConfig 的 IO 资源清理先例）；不做建议中的 BEGIN/COMMIT 包装——migrate.ts:46 内部已自行 BEGIN/COMMIT，外层再包事务会直接冲突 |
| H591 | packages/novel-store/src/driver.node.ts:13 | high | bug | fix | 同 C201：DatabaseSync 在 init 失败时泄漏，补 try/finally 关闭连接即可；错误向上传播本身符合本层设计，不需吞错加上下文 |
| H594 | packages/novel-store/src/entity-refs.ts:28 | high | bug | wontfix | delete-then-insert 的原子性问题已由 C203 覆盖（同一文件同一代码块）；追加 try-catch 包错误与 AGENTS.md 'Avoid try/catch where possible' 约定冲突，novel-store 数据层一贯让 drizzle 错误直接向上传播（如 approval.ts:51 throw 未找到章节） |
| C203 | packages/novel-store/src/entity-refs.ts:36 | critical | bug | fix | 真实数据丢失风险：delete 后任一 insert 失败则旧引用全部丢失；将 delete+inserts 包进 db.transaction 同步回调（index.ts:2083 既有模式），失败整体回滚 |
| H592 | packages/novel-store/src/manual-edit-sync.ts:56 | high | bug | fix | 将 enqueueManualEditSync 的 select→update→insert 包进 db.transaction 同步回调（bun-sqlite 驱动同步，回调内可全程无 await），消除并发入队时去重判定失效的窗口 |
| H593 | packages/novel-store/src/manual-edit-sync.ts:200 | high | bug | fix | 注释（manual-edit-sync.ts:200-206）声称'异常时先恢复旧值的补偿模式'但实现无任何补偿逻辑，且声称'Drizzle 的 Bun 驱动不支持事务包装'与 index.ts:2083 的 db.transaction 实际用法矛盾；应改用真实事务或把注释改写成与实际 best-effort 行为一致 |
| H598 | packages/novel-store/src/migrate.ts:58 | high | bug | fix | migrate.ts:59-63 回滚失败的 catch 为空，注释自称'保留现场便于排查'却无任何记录；在 catch 内补 console.error 记录 rollbackError（与 64/436 行既有 console.warn 风格一致），实现注释承诺的可排查性 |
| H597 | packages/novel-store/src/migrate.ts:425 | high | bug | wontfix | 刻意设计：425-443 行注释明确'单表搬移失败不阻塞 DB 打开，下次打开按幂等规则重试'，非阻塞幂等迁移是本文件贯穿哲学；且 SQLite 不允许在事务内切换 foreign_keys pragma（事务中该 pragma 为 no-op），建议的事务包装技术上不适用，孤儿行清理紧随其后（445-458 行） |
| C204 | packages/novel-store/src/migrate.ts:634 | critical | security | wontfix | 误报：migrate.ts:634-636 的单引号翻倍转义正是 SQLite 字符串字面量的标准且充分转义（SQLite 字符串无反斜杠转义陷阱，'' 即唯一转义），被转义值无法突破字面量；数据源自本地库自身写入（本迁移每次建连对 evidence 回填），参数化还需改动整个 ExecFn 字符串签名抽象 |
| H595 | packages/novel-store/src/mode.ts:116 | high | bug | wontfix | 文档化设计：mode.ts:12-15 错误策略与 108-110 行函数注释明确'任何 IO 错都降级为 warn + 返回 fallback 配置，不抛错'，返回生效配置即承诺语义；改成 result 对象将破坏 plugin/server/CLI 三处共享调用方 |
| H596 | packages/novel-store/src/mode.ts:145 | high | bug | wontfix | 同 H595：写入失败返回 next（生效配置）是 mode.ts:13-14 与 108-110 明确记载的设计，告警经 stderr 给用户；返回'未生效'反而需要契约级返回类型变更 |
| C205 | packages/novel-store/src/upgrade.ts:201 | critical | bug | wontfix | 刻意设计：upgrade.ts:195-199 注释声明'四步全部幂等'，任一步失败后可由 listPendingUpgradeTasks 的 appliesTo 检测重新触发恢复；且本包驱动为同步事务回调（index.ts:2083 同步用法），无法跨越 await 包住 runDeterministicUpgrade 的 async 流程，建议的事务包装不适用 |
| H599 | packages/novel-store/src/upgrade.ts:277 | high | bug | fix | novel_id 是 upgrade_state 主键（index.ts 表定义 text().notNull().primaryKey()），并发 read-then-insert 虽不会产生重复行但会把 PRIMARY KEY 约束错误抛给调用方；改 insert...onConflictDoUpdate({target: novel_id}) 原子 upsert |
| H117 | packages/opennovel/package.json:9 | high | bug |  |  |
| H604 | packages/opennovel/script/bench-test-suite.ts:23 | high | bug |  |  |
| H601 | packages/opennovel/script/build-node.ts:13 | high | bug |  |  |
| C207 | packages/opennovel/script/build-node.ts:15 | critical | bug |  |  |
| H600 | packages/opennovel/script/build.ts:14 | high | bug |  |  |
| C206 | packages/opennovel/script/build.ts:162 | critical | bug |  |  |
| H603 | packages/opennovel/script/generate.ts:8 | high | maintainability |  |  |
| H602 | packages/opennovel/script/httpapi-exercise.ts:1 | high | bug |  |  |
| H124 | packages/opennovel/script/postinstall.mjs:172 | high | bug |  |  |
| H605 | packages/opennovel/script/profile-test-files.ts:14 | high | bug |  |  |
| H608 | packages/opennovel/script/publish.ts:? | high | security |  |  |
| H609 | packages/opennovel/script/publish.ts:128 | high | bug |  |  |
| H611 | packages/opennovel/script/schema.ts:67 | high | bug |  |  |
| C208 | packages/opennovel/script/time.ts:4 | critical | security |  |  |
| H606 | packages/opennovel/specs/v2/api.ts:1 | high | maintainability |  |  |
| H607 | packages/opennovel/specs/v2/api.ts:41 | high | bug |  |  |
| H610 | packages/opennovel/src/account/repo.ts:46 | high | bug |  |  |
| C209 | packages/opennovel/src/account/repo.ts:59 | critical | bug |  |  |
| H614 | packages/opennovel/src/account/url.ts:2 | high | bug |  |  |
| H612 | packages/opennovel/src/acp/config-option.ts:199 | high | bug |  |  |
| H613 | packages/opennovel/src/acp/event.ts:125 | high | maintainability |  |  |
| H616 | packages/opennovel/src/acp/permission.ts:99 | high | security |  |  |
| H615 | packages/opennovel/src/acp/permission.ts:110 | high | bug |  |  |
| H619 | packages/opennovel/src/acp/profile.ts:1 | high | bug |  |  |
| H618 | packages/opennovel/src/acp/session.ts:153 | high | bug |  |  |
| H617 | packages/opennovel/src/acp/session.ts:219 | high | bug |  |  |
| H623 | packages/opennovel/src/agent/agent.ts:419 | high | bug |  |  |
| C210 | packages/opennovel/src/agent/subagent-permissions.ts:18 | critical | bug |  |  |
| H620 | packages/opennovel/src/auth/index.ts:73 | high | bug |  |  |
| H621 | packages/opennovel/src/cli/cmd/agent.ts:71 | high | maintainability |  |  |
| H624 | packages/opennovel/src/cli/cmd/attach.ts:7 | high | maintainability |  |  |
| H622 | packages/opennovel/src/cli/cmd/db.ts:38 | high | bug |  |  |
| C211 | packages/opennovel/src/cli/cmd/debug/agent.handler.ts:105 | critical | security |  |  |
| C212 | packages/opennovel/src/cli/cmd/debug/agent.ts:18 | critical | security |  |  |
| H628 | packages/opennovel/src/cli/cmd/debug/config.ts:12 | high | security |  |  |
| H625 | packages/opennovel/src/cli/cmd/debug/scrap.ts:8 | high | bug |  |  |
| C213 | packages/opennovel/src/cli/cmd/debug/v2.ts:18 | critical | bug |  |  |
| H626 | packages/opennovel/src/cli/cmd/debug/v2.ts:31 | high | maintainability |  |  |
| H627 | packages/opennovel/src/cli/cmd/export.ts:93 | high | maintainability |  |  |
| C214 | packages/opennovel/src/cli/cmd/generate.ts:20 | critical | bug |  |  |
| C215 | packages/opennovel/src/cli/cmd/github.handler.ts:387 | critical | bug |  |  |
| H629 | packages/opennovel/src/cli/cmd/github.handler.ts:631 | high | security |  |  |
| H633 | packages/opennovel/src/cli/cmd/import.ts:143 | high | bug |  |  |
| H632 | packages/opennovel/src/cli/cmd/import.ts:199 | high | maintainability |  |  |
| H630 | packages/opennovel/src/cli/cmd/models.ts:36 | high | bug |  |  |
| H631 | packages/opennovel/src/cli/cmd/novel.ts:89 | high | security |  |  |
| H635 | packages/opennovel/src/cli/cmd/pr.ts:54 | high | bug |  |  |
| H634 | packages/opennovel/src/cli/cmd/serve.ts:15 | high | security |  |  |
| H636 | packages/opennovel/src/cli/cmd/stats.ts:117 | high | bug |  |  |
| H638 | packages/opennovel/src/cli/cmd/uninstall.ts:299 | high | bug |  |  |
| H637 | packages/opennovel/src/cli/cmd/web.ts:40 | high | security |  |  |
| H640 | packages/opennovel/src/cli/effect-cmd.ts:90 | high | bug |  |  |
| H641 | packages/opennovel/src/cli/heap.ts:32 | high | bug |  |  |
| H639 | packages/opennovel/src/cli/network.ts:41 | high | bug |  |  |
| H643 | packages/opennovel/src/cli/ui.ts:47 | high | bug |  |  |
| H644 | packages/opennovel/src/cli/ui.ts:74 | high | bug |  |  |
| H645 | packages/opennovel/src/command/index.ts:123 | high | bug |  |  |
| H642 | packages/opennovel/src/config/agent.ts:50 | high | maintainability |  |  |
| H647 | packages/opennovel/src/config/config.ts:425 | high | bug |  |  |
| H646 | packages/opennovel/src/config/managed.ts:35 | high | bug |  |  |
| H648 | packages/opennovel/src/config/parse.ts:74 | high | bug |  |  |
| H650 | packages/opennovel/src/config/plugin.ts:56 | high | bug |  |  |
| H649 | packages/opennovel/src/control-plane/adapters/index.ts:9 | high | maintainability |  |  |
| H652 | packages/opennovel/src/control-plane/adapters/worktree.ts:45 | high | bug |  |  |
| C216 | packages/opennovel/src/control-plane/dev/debug-workspace-plugin.ts:27 | critical | bug |  |  |
| H651 | packages/opennovel/src/control-plane/dev/debug-workspace-plugin.ts:54 | high | bug |  |  |
| H653 | packages/opennovel/src/control-plane/util.ts:8 | high | bug |  |  |
| C217 | packages/opennovel/src/control-plane/util.ts:24 | critical | bug |  |  |
| H655 | packages/opennovel/src/control-plane/workspace.ts:587 | high | bug |  |  |
| H658 | packages/opennovel/src/effect/bridge.ts:68 | high | bug |  |  |
| H654 | packages/opennovel/src/effect/instance-registry.ts:10 | high | bug |  |  |
| H665 | packages/opennovel/src/effect/instance-state.ts:38 | high | bug |  |  |
| H666 | packages/opennovel/src/effect/instance-state.ts:38 | high | bug |  |  |
| H656 | packages/opennovel/src/effect/run-service.ts:28 | high | bug |  |  |
| H657 | packages/opennovel/src/effect/run-service.ts:34 | high | bug |  |  |
| H660 | packages/opennovel/src/effect/runner.ts:83 | high | bug |  |  |
| H661 | packages/opennovel/src/effect/runner.ts:108 | high | bug |  |  |
| H659 | packages/opennovel/src/env/index.ts:26 | high | bug |  |  |
| C218 | packages/opennovel/src/event-manifest.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H662 | packages/opennovel/src/format/formatter.ts:74 | high | bug |  |  |
| H663 | packages/opennovel/src/format/formatter.ts:198 | high | bug |  |  |
| H664 | packages/opennovel/src/format/formatter.ts:225 | high | bug |  |  |
| C219 | packages/opennovel/src/id/id.ts:54 | critical | bug |  |  |
| H667 | packages/opennovel/src/id/id.ts:72 | high | bug |  |  |
| C221 | packages/opennovel/src/image/image.ts:126 | critical | bug |  |  |
| H670 | packages/opennovel/src/index.ts:37 | high | bug |  |  |
| C220 | packages/opennovel/src/installation/index.ts:145 | critical | security |  |  |
| H668 | packages/opennovel/src/installation/index.ts:216 | high | bug |  |  |
| H669 | packages/opennovel/src/installation/index.ts:245 | high | bug |  |  |
| H673 | packages/opennovel/src/lsp/lsp.ts:244 | high | bug |  |  |
| H672 | packages/opennovel/src/lsp/lsp.ts:267 | high | bug |  |  |
| H675 | packages/opennovel/src/lsp/server.ts:183 | high | security |  |  |
| H676 | packages/opennovel/src/mcp/auth.ts:67 | high | bug |  |  |
| C223 | packages/opennovel/src/mcp/browser.ts:19 | critical | bug |  |  |
| C222 | packages/opennovel/src/mcp/catalog.ts:26 | critical | bug |  |  |
| H671 | packages/opennovel/src/mcp/catalog.ts:43 | high | bug |  |  |
| H677 | packages/opennovel/src/mcp/index.ts:109 | high | bug |  |  |
| H678 | packages/opennovel/src/mcp/index.ts:898 | high | bug |  |  |
| H679 | packages/opennovel/src/mcp/index.ts:901 | high | bug |  |  |
| H674 | packages/opennovel/src/mcp/oauth-callback.ts:133 | high | bug |  |  |
| C224 | packages/opennovel/src/novel/manual-edit-sync-worker.ts:? | critical | bug |  |  |
| H680 | packages/opennovel/src/plugin/cloudflare.ts:71 | high | bug |  |  |
| C225 | packages/opennovel/src/plugin/digitalocean.ts:37 | critical | bug |  |  |
| H683 | packages/opennovel/src/plugin/digitalocean.ts:62 | high | bug |  |  |
| H682 | packages/opennovel/src/plugin/github-copilot/copilot.ts:262 | high | bug |  |  |
| H681 | packages/opennovel/src/plugin/github-copilot/copilot.ts:287 | high | bug |  |  |
| H685 | packages/opennovel/src/plugin/github-copilot/models.ts:213 | high | bug |  |  |
| H684 | packages/opennovel/src/plugin/index.ts:274 | high | bug |  |  |
| H686 | packages/opennovel/src/plugin/loader.ts:187 | high | bug |  |  |
| H687 | packages/opennovel/src/plugin/openai/codex.ts:152 | high | bug |  |  |
| H689 | packages/opennovel/src/plugin/openai/codex.ts:219 | high | bug |  |  |
| H688 | packages/opennovel/src/plugin/openai/codex.ts:238 | high | bug |  |  |
| H690 | packages/opennovel/src/plugin/openai/ws-pool.ts:78 | high | bug |  |  |
| C227 | packages/opennovel/src/plugin/openai/ws.ts:181 | critical | bug |  |  |
| C228 | packages/opennovel/src/plugin/openai/ws.ts:198 | critical | bug |  |  |
| H694 | packages/opennovel/src/plugin/openai/ws.ts:208 | high | bug |  |  |
| H695 | packages/opennovel/src/plugin/openai/ws.ts:282 | high | bug |  |  |
| C226 | packages/opennovel/src/plugin/shared.ts:205 | critical | bug |  |  |
| H692 | packages/opennovel/src/plugin/snowflake-cortex.ts:34 | high | maintainability |  |  |
| H693 | packages/opennovel/src/plugin/snowflake-cortex.ts:316 | high | bug |  |  |
| H691 | packages/opennovel/src/plugin/xai.ts:351 | high | security |  |  |
| H696 | packages/opennovel/src/project/instance-store.ts:126 | high | bug |  |  |
| H699 | packages/opennovel/src/project/project.ts:417 | high | bug |  |  |
| H700 | packages/opennovel/src/project/project.ts:434 | high | bug |  |  |
| H701 | packages/opennovel/src/project/vcs.ts:11 | high | performance |  |  |
| H702 | packages/opennovel/src/project/vcs.ts:88 | high | bug |  |  |
| H697 | packages/opennovel/src/provider/auth.ts:167 | high | bug |  |  |
| H698 | packages/opennovel/src/provider/auth.ts:203 | high | bug |  |  |
| H703 | packages/opennovel/src/provider/ollama-models.ts:84 | high | security |  |  |
| H704 | packages/opennovel/src/provider/provider.ts:46 | high | bug |  |  |
| C229 | packages/opennovel/src/provider/provider.ts:1794 | critical | security |  |  |
| H707 | packages/opennovel/src/provider/transform.ts:82 | high | bug |  |  |
| H708 | packages/opennovel/src/provider/transform.ts:367 | high | bug |  |  |
| C230 | packages/opennovel/src/question/index.ts:124 | critical | bug |  |  |
| C231 | packages/opennovel/src/question/index.ts:141 | critical | bug |  |  |
| H705 | packages/opennovel/src/server/auth.ts:24 | high | security |  |  |
| C232 | packages/opennovel/src/server/auth.ts:28 | critical | security |  |  |
| H706 | packages/opennovel/src/server/global-lifecycle.ts:19 | high | bug |  |  |
| H709 | packages/opennovel/src/server/mdns.ts:22 | high | maintainability |  |  |
| H710 | packages/opennovel/src/server/proxy-util.ts:23 | high | bug |  |  |
| H711 | packages/opennovel/src/server/routes/instance/httpapi/groups/config.ts:16 | high | security |  |  |
| C233 | packages/opennovel/src/server/routes/instance/httpapi/groups/config.ts:26 | critical | security |  |  |
| H714 | packages/opennovel/src/server/routes/instance/httpapi/groups/control.ts:12 | high | security |  |  |
| H713 | packages/opennovel/src/server/routes/instance/httpapi/groups/experimental.ts:187 | high | security |  |  |
| H712 | packages/opennovel/src/server/routes/instance/httpapi/groups/file.ts:15 | high | security |  |  |
| H715 | packages/opennovel/src/server/routes/instance/httpapi/groups/mcp.ts:21 | high | security |  |  |
| H716 | packages/opennovel/src/server/routes/instance/httpapi/groups/project-copy.ts:? | high | maintainability |  |  |
| H718 | packages/opennovel/src/server/routes/instance/httpapi/groups/project.ts:32 | high | bug |  |  |
| H717 | packages/opennovel/src/server/routes/instance/httpapi/groups/sync.ts:19 | high | security |  |  |
| C234 | packages/opennovel/src/server/routes/instance/httpapi/groups/tui.ts:88 | critical | bug |  |  |
| H719 | packages/opennovel/src/server/routes/instance/httpapi/groups/tui.ts:185 | high | security |  |  |
| H721 | packages/opennovel/src/server/routes/instance/httpapi/handlers/config.ts:14 | high | security |  |  |
| H720 | packages/opennovel/src/server/routes/instance/httpapi/handlers/control.ts:13 | high | bug |  |  |
| H722 | packages/opennovel/src/server/routes/instance/httpapi/handlers/event.ts:12 | high | bug |  |  |
| C236 | packages/opennovel/src/server/routes/instance/httpapi/handlers/pty.ts:225 | critical | bug |  |  |
| H723 | packages/opennovel/src/server/routes/instance/httpapi/handlers/pty.ts:244 | high | bug |  |  |
| C235 | packages/opennovel/src/server/routes/instance/httpapi/handlers/pty.ts:248 | critical | bug |  |  |
| H724 | packages/opennovel/src/server/routes/instance/httpapi/handlers/sync.ts:27 | high | bug |  |  |
| H725 | packages/opennovel/src/server/routes/instance/httpapi/handlers/sync.ts:74 | high | bug |  |  |
| C237 | packages/opennovel/src/server/routes/instance/httpapi/handlers/tui.ts:51 | critical | bug |  |  |
| H728 | packages/opennovel/src/server/routes/instance/httpapi/handlers/workspace.ts:64 | high | bug |  |  |
| H726 | packages/opennovel/src/server/routes/instance/httpapi/middleware/authorization.ts:12 | high | security |  |  |
| H727 | packages/opennovel/src/server/routes/instance/httpapi/middleware/compression.ts:57 | high | performance |  |  |
| H730 | packages/opennovel/src/server/routes/instance/httpapi/middleware/fence.ts:17 | high | bug |  |  |
| H731 | packages/opennovel/src/server/routes/instance/httpapi/middleware/instance-context.ts:23 | high | bug |  |  |
| C238 | packages/opennovel/src/server/routes/instance/httpapi/middleware/instance-context.ts:29 | critical | security |  |  |
| H729 | packages/opennovel/src/server/routes/instance/httpapi/middleware/schema-error.ts:40 | high | security |  |  |
| H732 | packages/opennovel/src/server/routes/instance/httpapi/middleware/workspace-routing.ts:87 | high | security |  |  |
| C009 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.html:? | critical | security |  |  |
| H055 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.html:1144 | high | bug |  |  |
| C239 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.ts:23 | critical | security |  |  |
| H734 | packages/opennovel/src/server/routes/instance/httpapi/novel-reader.ts:94 | high | bug |  |  |
| H736 | packages/opennovel/src/server/routes/instance/httpapi/websocket-tracker.ts:18 | high | bug |  |  |
| H733 | packages/opennovel/src/server/server.ts:72 | high | bug |  |  |
| H735 | packages/opennovel/src/server/shared/tui-control.ts:11 | high | maintainability |  |  |
| H737 | packages/opennovel/src/server/shared/workspace-routing.ts:20 | high | bug |  |  |
| H738 | packages/opennovel/src/server/shared/workspace-routing.ts:31 | high | bug |  |  |
| H739 | packages/opennovel/src/session/compaction.ts:296 | high | bug |  |  |
| H740 | packages/opennovel/src/session/instruction.ts:95 | high | security |  |  |
| H743 | packages/opennovel/src/session/llm.ts:157 | high | bug |  |  |
| H741 | packages/opennovel/src/session/llm/request.ts:212 | high | bug |  |  |
| H742 | packages/opennovel/src/session/llm/request.ts:224 | high | bug |  |  |
| C240 | packages/opennovel/src/session/prompt.ts:? | critical | security |  |  |
| H749 | packages/opennovel/src/session/prompt.ts:170 | high | security |  |  |
| H750 | packages/opennovel/src/session/prompt.ts:813 | high | security |  |  |
| H744 | packages/opennovel/src/session/reminders.ts:26 | high | bug |  |  |
| H745 | packages/opennovel/src/session/reminders.ts:78 | high | bug |  |  |
| H746 | packages/opennovel/src/session/revert.ts:44 | high | bug |  |  |
| C241 | packages/opennovel/src/session/run-state.ts:74 | critical | bug |  |  |
| H751 | packages/opennovel/src/session/run-state.ts:125 | high | bug |  |  |
| H747 | packages/opennovel/src/session/session.ts:606 | high | bug |  |  |
| H748 | packages/opennovel/src/session/status.ts:39 | high | bug |  |  |
| H752 | packages/opennovel/src/session/system.ts:121 | high | bug |  |  |
| H755 | packages/opennovel/src/session/todo.ts:49 | high | bug |  |  |
| H756 | packages/opennovel/src/session/todo.ts:49 | high | bug |  |  |
| H757 | packages/opennovel/src/session/todo.ts:49 | high | bug |  |  |
| H760 | packages/opennovel/src/session/tools.ts:127 | high | bug |  |  |
| H754 | packages/opennovel/src/setting-organization.ts:80 | high | bug |  |  |
| H753 | packages/opennovel/src/setting-organization.ts:133 | high | bug |  |  |
| H758 | packages/opennovel/src/share/session.ts:26 | high | bug |  |  |
| H759 | packages/opennovel/src/share/share-next.ts:130 | high | bug |  |  |
| C242 | packages/opennovel/src/share/share-next.ts:253 | critical | bug |  |  |
| H766 | packages/opennovel/src/skill/discovery.ts:49 | high | security |  |  |
| C243 | packages/opennovel/src/skill/discovery.ts:79 | critical | security |  |  |
| H764 | packages/opennovel/src/skill/index.ts:325 | high | security |  |  |
| H765 | packages/opennovel/src/skill/index.ts:340 | high | security |  |  |
| H761 | packages/opennovel/src/snapshot/index.ts:623 | high | bug |  |  |
| H762 | packages/opennovel/src/snapshot/index.ts:656 | high | bug |  |  |
| H763 | packages/opennovel/src/snapshot/index.ts:743 | high | bug |  |  |
| H769 | packages/opennovel/src/storage/storage.ts:301 | high | maintainability |  |  |
| H767 | packages/opennovel/src/tool/apply_patch.ts:77 | high | bug |  |  |
| H768 | packages/opennovel/src/tool/apply_patch.ts:241 | high | bug |  |  |
| H770 | packages/opennovel/src/tool/edit.ts:37 | high | bug |  |  |
| H771 | packages/opennovel/src/tool/edit.ts:174 | high | bug |  |  |
| H775 | packages/opennovel/src/tool/grep.ts:110 | high | bug |  |  |
| H772 | packages/opennovel/src/tool/json-schema.ts:6 | high | bug |  |  |
| H773 | packages/opennovel/src/tool/mcp-websearch.ts:4 | high | security |  |  |
| H774 | packages/opennovel/src/tool/mcp-websearch.ts:92 | high | bug |  |  |
| H776 | packages/opennovel/src/tool/question.ts:? | high | bug |  |  |
| H778 | packages/opennovel/src/tool/read.ts:159 | high | performance |  |  |
| H777 | packages/opennovel/src/tool/registry.ts:391 | high | bug |  |  |
| H782 | packages/opennovel/src/tool/skill.ts:? | high | security |  |  |
| H784 | packages/opennovel/src/tool/skill.ts:? | high | bug |  |  |
| H783 | packages/opennovel/src/tool/skill.ts:23 | high | bug |  |  |
| H779 | packages/opennovel/src/tool/tool.ts:146 | high | bug |  |  |
| H780 | packages/opennovel/src/tool/webfetch.ts:82 | high | bug |  |  |
| H781 | packages/opennovel/src/tool/webfetch.ts:155 | high | bug |  |  |
| H785 | packages/opennovel/src/tool/websearch.ts:140 | high | bug |  |  |
| C244 | packages/opennovel/src/util/archive.ts:9 | critical | security |  |  |
| H786 | packages/opennovel/src/util/data-url.ts:7 | high | bug |  |  |
| H787 | packages/opennovel/src/util/defer.ts:3 | high | bug |  |  |
| H788 | packages/opennovel/src/util/error.ts:5 | high | bug |  |  |
| H789 | packages/opennovel/src/util/lazy.ts:5 | high | bug |  |  |
| H790 | packages/opennovel/src/util/local-context.ts:3 | high | bug |  |  |
| H793 | packages/opennovel/src/util/locale.ts:66 | high | bug |  |  |
| H792 | packages/opennovel/src/util/queue.ts:1 | high | bug |  |  |
| H791 | packages/opennovel/src/util/queue.ts:16 | high | bug |  |  |
| H796 | packages/opennovel/src/util/repository.ts:83 | high | security |  |  |
| H794 | packages/opennovel/src/util/rpc.ts:7 | high | bug |  |  |
| H795 | packages/opennovel/src/util/rpc.ts:8 | high | bug |  |  |
| H797 | packages/opennovel/src/util/signal.ts:4 | high | bug |  |  |
| H800 | packages/opennovel/src/util/timeout.ts:3 | high | bug |  |  |
| C246 | packages/opennovel/src/worktree/index.ts:461 | critical | security |  |  |
| C245 | packages/opennovel/test/cli/acp/acp-test-client.ts:46 | critical | bug |  |  |
| H799 | packages/opennovel/test/cli/acp/acp-test-client.ts:52 | high | bug |  |  |
| H798 | packages/opennovel/test/cli/acp/acp-test-client.ts:89 | high | bug |  |  |
| H801 | packages/opennovel/test/cli/acp/helpers.ts:70 | high | bug |  |  |
| C247 | packages/opennovel/test/fake/auth.ts:4 | critical | bug |  |  |
| H803 | packages/opennovel/test/fake/npm.ts:4 | high | bug |  |  |
| H802 | packages/opennovel/test/fake/npm.ts:8 | high | bug |  |  |
| H804 | packages/opennovel/test/fixture/config.ts:10 | high | bug |  |  |
| H805 | packages/opennovel/test/fixture/plugin-meta-worker.ts:17 | high | bug |  |  |
| H806 | packages/opennovel/test/lib/filesystem.ts:4 | high | bug |  |  |
| H807 | packages/opennovel/test/server/httpapi-exercise/assertions.ts:20 | high | bug |  |  |
| H808 | packages/opennovel/test/server/httpapi-exercise/backend.ts:53 | high | bug |  |  |
| H809 | packages/opennovel/test/server/httpapi-exercise/runtime.ts:20 | high | bug |  |  |
| C248 | packages/opennovel/test/server/httpapi-layer.ts:21 | critical | bug |  |  |
| H118 | packages/plugin/package.json:8 | high | bug | wontfix | 误报：package.json devDependencies 含 @typescript/native-preview（catalog:），该包正是 tsgo CLI 的分发包，typecheck 脚本在包内可用。 |
| C062 | packages/plugin/package.json:12 | critical | bug | wontfix | 既定模式：script/publish.ts:26-40 在 pack 前把 exports 重写为 dist/*.js + .d.ts 再 npm publish，发布后 exports 与 files:[dist] 一致；workspace 内直接消费 TS 源码是本仓 monorepo 惯例。 |
| H810 | packages/plugin/script/publish.ts:32 | high | bug | wontfix | 误报：publish.ts:31-37 是 try/finally（无 catch），finally 恢复 package.json 后原错误继续向上传播，不会被静默吞掉。 |
| H811 | packages/plugin/script/publish.ts:33 | high | bug | fix | publish.ts:34 npm publish *.tgz 在遗留 tarball 存在时会匹配多个文件导致发布失败；发布前清理旧 tgz 或改用精确文件名（ui/script/publish.ts:23 已用精确名可循例）。 |
| H812 | packages/plugin/src/example-workspace.ts:20 | high | bug | wontfix | 断言安全：example-workspace.ts:16-18 configure 恒为 directory 赋 /tmp/folder/folder-${rand} 值，remove/target 被调用时 directory 必存在；create 亦有 if (!config.directory) return 守卫，属示例代码的刻意简写。 |
| H813 | packages/plugin/src/novel-writer/__verify__/verify-tools.ts:47 | high | bug | wontfix | 退出码契约已满足：verify-tools.ts:268-273 正常路径按 failures 数 process.exit(0/1)，抛错时 unhandled rejection 退出码同为 1（符合文件头约定）；verify.db 残留由下次运行开头的 rmSync(force) 自清理。 |
| C249 | packages/plugin/src/novel-writer/agents/auditor.ts:1 | critical | bug | fix | auditor.ts:39 与维度清单实为 38 项（94-95 行编号到 38），但 submit_chapter_review 按 CONTINUITY_DIMENSIONS（continuity-check.ts:58-113，仅 37 项、无「书籍坐标泄漏」）校验并拒绝清单外维度；LLM 按 38 维提交会被拒，需把提示词统一回 37 维口径。 |
| H814 | packages/plugin/src/novel-writer/annotation.ts:99 | high | bug | fix | annotation.ts:98-99 quote 回退分支用 replace() 只替换首个匹配，段落内 quote 重复时会改错位置；要求 quote 在段落内唯一（indexOf===lastIndexOf）否则视为 stale/拒绝。 |
| H815 | packages/plugin/src/novel-writer/arc-backfill.ts:144 | high | bug | wontfix | 刻意设计：arc-backfill.ts:201 注释表明对事务边界有明确意识（drizzle async 事务在 bun:sqlite 下不回滚），流程为读快照→校验/去重决策→BEGIN 后写入；单用户本地 SQLite 下另一连接改写窗口极小，且把读挪进事务并不能让去重决策更正确。 |
| C250 | packages/plugin/src/novel-writer/arc-progress.ts:21 | critical | bug | fix | arc-progress.ts:21-114 多处相互依赖写入无事务保护，中途失败留不一致状态；按仓库既有惯例（arc-backfill.ts:201-202 原生 BEGIN/COMMIT/ROLLBACK）包裹。 |
| H819 | packages/plugin/src/novel-writer/arc-progress.ts:21 | high | bug | wontfix | 冲突仓库风格：AGENTS.md 明确 Avoid try/catch where possible，错误传播到 tool execute 层由框架统一处理；与全仓其它 DB 函数行为一致，加 try-catch 属风格冲突且无行为收益。 |
| H818 | packages/plugin/src/novel-writer/arc-progress.ts:116 | high | bug | fix | arc-progress.ts:116 set(patch as never) 完全绕过类型检查；patch 仅含 StoryArcTable 已知列，改用 Partial<typeof StoryArcTable.$inferInsert> 或逐列构造即可消除 never 强转。 |
| H821 | packages/plugin/src/novel-writer/budget.ts:271 | high | bug | fix | budget.ts:254 计算的 indexBudget 未被使用、271 行仍用常量 INDEX_BUDGET，P5 紧张时索引导览会挤占 core 预算使总盘超限；改用 indexBudget。 |
| H816 | packages/plugin/src/novel-writer/chapter-normalize.ts:49 | high | bug | wontfix | 无暴露面：normalizeChapter 在全仓无任何调用方（src/test 均仅定义处），参数为类型化 string，加运行时防御检查不符合仓库风格。 |
| H817 | packages/plugin/src/novel-writer/chapter-normalize.ts:52 | high | bug | wontfix | 同上：normalizeChapter 无调用方，targetLength 为类型化 number 且不在信任边界，0/NaN 场景不可达，加校验属死代码。 |
| C252 | packages/plugin/src/novel-writer/chapter-rebuild.ts:64 | critical | bug | wontfix | 刻意设计：bun:sqlite 为同步驱动，async helper 只是 Promise 包装且复用同一 db 连接（chapter-rebuild.ts:90-93 传入 db），事务内顺序执行无交错；模块头注释声明「数据库写入使用事务，失败不留下半更新状态」，catch 中统一 ROLLBACK。 |
| H822 | packages/plugin/src/novel-writer/chapter-rebuild.ts:114 | high | bug | wontfix | chapter-rebuild.ts:110-113 catch 中原始错误 rethrow，仅吞掉 ROLLBACK 自身的次要错误；同步驱动下 ROLLBACK 失败仅发生于无活动事务时，无一致性风险，保留原错误是正确取舍。 |
| H820 | packages/plugin/src/novel-writer/chapter-rollback.ts:54 | high | bug | defer | 根治需在 ChapterVersionTable 加 (chapter_id, version) 唯一约束（涉及 novel-store schema 与 tui.tsx/cli.ts 多处 CREATE TABLE 副本）并改全仓 max+1 模式（novel-writer.ts:6275 nextVersion 同模式），属 schema 契约级变更；本工具并发回滚同一章场景几乎不存在。 |
| C251 | packages/plugin/src/novel-writer/chapter-rollback.ts:65 | critical | bug | fix | chapter-rollback.ts:68-87 备份版本插入与章节恢复更新是两个独立操作，中途失败留半提交状态；按仓库惯例包原生 BEGIN/COMMIT/ROLLBACK。 |
| C253 | packages/plugin/src/novel-writer/chapter-status.ts:61 | critical | bug | fix | chapter-status.ts:61-90 状态读-改-写无原子保护，并发调用可双过校验；按仓库惯例用原生事务包裹，或在 UPDATE 的 WHERE 中加 status=currentStatus 乐观锁。 |
| H825 | packages/plugin/src/novel-writer/chapter-status.ts:66 | high | bug | fix | chapter-status.ts:66 chapter.status as ChapterStatus 在 DB 值为 draft/outline 时（novel-store/src/index.ts:88 默认 draft、outline.ts:358 建章用 outline，均不在 CHAPTER_STATUSES）令 ALLOWED_TRANSITIONS[currentStatus] 为 undefined，canTransitionTo 的 .includes 抛 TypeError；需把未知状态纳入状态机或显式校验。 |
| H826 | packages/plugin/src/novel-writer/cli.ts:106 | high | bug | wontfix | 冲突仓库风格：AGENTS.md 要求避免 try/catch；createBook 已对题材校验给出友好错误（cli.ts:104-106），DB 约束错误文本可读并由 CLI 层统一兜底。 |
| H827 | packages/plugin/src/novel-writer/cli.ts:360 | high | bug | fix | cli.ts:360 JSON.parse 直接解析用户提供的文件，语法错误以无上下文 SyntaxError 崩出；包 try/catch 输出「导入文件不是合法 JSON」类友好错误（用户输入属信任边界，符合风格例外）。 |
| C254 | packages/plugin/src/novel-writer/context.ts:409 | critical | bug | wontfix | 误报：context.ts:396 .map(({ arc }) => { 是块体回调，418-426 的 const 声明与 427 的 return 都在回调体内正常执行，仅 411/437 行缩进不齐；代码可编译运行，unreachable/merge error 的判断不实。 |
| H824 | packages/plugin/src/novel-writer/drift-guards.ts:114 | high | performance | fix | drift-guards.ts:101-105 无 WHERE 全表扫描 character_states 再在内存按 characterIds 过滤；该表无 novel_id 列，改用 inArray(CharacterStateTable.character_id, [...characterIds]) 在 SQL 层过滤避免全表加载。 |
| H823 | packages/plugin/src/novel-writer/edit-sync-gate.ts:108 | high | bug | wontfix | 三条均不成立：(1) 加 try-catch 与仓库 Avoid try/catch 风格冲突，错误由 tool 层处理；(2) bun:sqlite 同步驱动顺序更新开销可忽略，Promise.all 同连接无收益；(3) 空数组 for 循环本就是 no-op 且 getDb 走缓存。 |
| H829 | packages/plugin/src/novel-writer/technique-extract.ts:49 | high | bug | fix | technique-extract.ts:49,94 llm() 网络异常会丢弃整批已收集结果；按模块自身容错设计（parseFailures 计数）把单次调用失败计入 parseFailures 并 continue 该分段。 |
| H828 | packages/plugin/src/novel-writer/technique-hindsight.ts:10 | high | bug | wontfix | 误报：technique.ts:70-72 sceneTypes/evidence 为必填数组类型，technique-normalize.ts:18-20 保证其存在（toCanonicalSceneTypes(partial.sceneTypes) 与 partial.evidence ?? []）；evidence[0]?. 是数组元素访问守卫而非数组 undefined 守卫，「不一致」判断不实。 |
| H999 | packages/plugin/src/novel-writer/tui.tsx:58 | high | bug | wontfix | 已有覆盖：tui.tsx:160-164 插件入口 try/catch（注释「数据库不可用，跳过」）包裹 hasNovels 调用，getDb 抛错同样被捕获并降级跳过向导，处理已在失败点上游闭环。 |
| C256 | packages/schema/src/credential.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H831 | packages/schema/src/event.ts:88 | high | bug | wontfix | 引用相等恰好匹配注册模型：definition 均为模块级单例（schema/src/event.ts:42-70 define() 每次新建对象），latest() 把'同一对象被多个清单重复收录'视为合法去重（80-83 行直接 set 跳过），'两个不同对象声明同一 type'（88 行抛错）才是真正的重复注册错误；Effect Schema 无廉价可靠的结构相等比较，放宽会削弱守卫 |
| C255 | packages/schema/src/file-diff.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C257 | packages/schema/src/mcp-event.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H833 | packages/schema/src/permission-saved.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H832 | packages/schema/src/project-copy.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C258 | packages/schema/src/prompt-input.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H834 | packages/schema/src/pty-ticket.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C259 | packages/schema/src/pty.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H835 | packages/schema/src/pty.ts:16 | high | security | wontfix | ascending(id?) 是全仓库统一的'采纳既有 ID 或新建'约定（opennovel/src/session/schema.ts:13、tool/schema.ts:12、sync/schema.ts:9、workspace.ts:493 均同构）；Pty.ID.ascending 目前无任何带参调用方，且外部 pty id 输入在 protocol 边界经 params:{ptyID: Pty.ID} decode 校验（protocol/src/groups/pty.ts:52-120），无校验绕过路径 |
| H836 | packages/schema/src/question.ts:1 | high | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| C260 | packages/schema/src/session-delivery.ts:1 | critical | bug | wontfix | self-export 惯例：首行 export * as X 引用自身（AGENTS.md 规定），非循环导入 |
| H842 | packages/server/src/annotation-targets.ts:24 | high | bug | wontfix | 契约被误读：annotation-targets.ts:15 注释明确 null 仅表示'目标不存在或不属于当前 novel'，不承诺吞错；若把 DB 错误返回 null，novel.ts:1867 会把它误报成 404 novelNotFound，掩盖基础设施故障；当前抛错进 Effect 错误通道才是正确语义，且符合 avoid try/catch 约定 |
| H846 | packages/server/src/auth.ts:44 | high | security | fix | 改用 crypto.timingSafeEqual 做常量时间密码比较（长度不等先返回 false 避免其抛错），替换 auth.ts 的 === 字符串比较 |
| H844 | packages/server/src/cors.ts:11 | high | security | wontfix | 刻意设计：cors.ts:10-11 无 Origin 即放行是为非浏览器客户端（CLI/桌面/侧车请求不带 Origin），CORS 本质是浏览器强制机制、非认证边界；改成 false 会直接打断 CLI/桌面全部请求，白名单（localhost/oc://renderer/tauri/opennovel.ai/opts.cors）已覆盖浏览器面 |
| C261 | packages/server/src/handlers/credential.ts:7 | critical | security | wontfix | 单用户模型下 BOLA 前提不成立：middleware/authorization.ts 用全局 Basic 认证（OPENNOVEL_SERVER_PASSWORD 单用户名/密码）包装全部端点，无多用户/属主概念；core integration 的 connection.update/remove（core/src/integration.ts:173-176）本身就没有用户维度，加属主校验是无意义的空操作 |
| C262 | packages/server/src/handlers/event.ts:11 | critical | bug | fix | 真实缺陷：EventV2.all() 承载全量事件，发布方经 EventV2Bridge（event-v2-bridge.ts 包同一 core EventV2.Service 实例）会发出 ServerDefinitions 之外的类型（TuiEvent.ToastShow mcp/index.ts:304/315、McpEvent.ToolsChanged:451、VcsEvent.BranchUpdated vcs.ts:328、LspEvent.Updated lsp.ts:293 等），encodeUnknownSync 抛错会炸掉整条 SSE 流；修复=编码前按 OpenNovelEvent schema 过滤/跳过不合规事件并记日志，端点契约不变 |
| H845 | packages/server/src/handlers/event.ts:30 | high | bug | wontfix | 刻意背压设计：core/src/event.ts:152-162 用 Queue.dropping(256)+Queue.fail 专用 SubscriberOverflowError 熔断慢消费者，断连即背压信号，SSE 客户端断线自动重连并可经 durable 流恢复；加重试无意义（慢消费者会立即再次溢出），容量 256 与心跳/haltStrategy 均为有意配置 |
| C263 | packages/server/src/handlers/permission.ts:63 | critical | bug | wontfix | 误报：Effect 4 的 Schema.TaggedErrorClass 官方定义为 yieldable error（effect/src/Schema.ts 文档示例即 yield* new NotFound(...)），return yield* missingRequest(...) 正确进入错误通道并按 httpApiStatus:404 返回；同款模式遍布 question.ts:21、message.ts:35、provider.ts:24、pty.ts:125、session.ts:377 |
