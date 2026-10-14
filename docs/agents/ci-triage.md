# CI 排查与本地运维速记

本文件沉淀 openNovel 日常开发中的 CI 归因、重跑纪律与本地环境操作要点。flake 立案走 GitHub Issues（见 `docs/agents/issue-tracker.md`）。

## 归因先于修复

1. 先取 job 级日志，把失败定位到「workflow → job → step → 用例名」：
   - run 已结束：`gh run view --job <jobid> --repo MarsQiu007/openNovel --log`；
   - run 未结束：REST `.../actions/jobs/<jobid>/logs`（`Invoke-WebRequest` + `gh auth token`；`gh api` 调该端点会因终端转义序列报错）；
   - 对比同一次 run 的多次重跑：`.../actions/runs/<runid>/attempts/<n>/jobs`。
2. 归属判断三件套：①同一提交的前一个提交在同步骤是否通过；②本次 diff 能否影响该运行时（只改 markdown 一定不影响，改 CSS 会影响 e2e）；③失败签名是否与已立案 flake 一致。
3. 证明与本次改动无关之前，不要去修别人造成的红；证明是自己造成的，就定位到最小代码面再动手。

## 重跑纪律

- `gh run rerun <runid> --failed` 只作已知 flake 的止血；同一提交最多重跑 3 次，连续红必须停下来定位。
- flake 立案要素：run/job/step/用例名、前一提交对照、失败签名计数（如 effect 模式 `summary pass=257 fail=77`）、与本次 diff 无关性的证明、根因链（含文件:行号）、修复方向选项。

## 本地复现

- 先对齐 CI 的工具版本：CI 用 `packageManager` 指定的 bun（当前为 1.3.14），本机高版本行为可能不同。
- 取 CI 同款 bun（国内可达）：`https://registry.npmmirror.com/-/binary/bun/bun-v1.3.14/bun-windows-x64.zip`，解压即得 `bun.exe`。
- 复现命令照抄 workflow 里的那条，例如 app 浏览器用例：在 `packages/app` 下运行 `bun test --conditions=browser --preload ./happydom.ts ./test-browser`。

## 推送不可达（github.com 直连不稳时）

- `gh` 正常但 `git fetch/push` 报 `Failed to connect to github.com:443` 很常见：`api.github.com` 与 `github.com` 是不同 IP，一个通不代表另一个通。
- 诊断：逐 IP 做 TCP 探测（`TcpClient.BeginConnect` + `WaitOne` + `EndConnect`）；再用 `curl.exe -s -o NUL -w "%{http_code}" --resolve github.com:443:<ip> https://github.com/` 验证 TLS/SNI 层（TCP 通不代表 TLS 通）。
- 绕行：临时把系统 hosts 文件里的 `github.com` 指到可达 IP（曾实测可达：`140.82.112.4`、`140.82.113.4`、`20.205.243.166`，以实测为准），`ipconfig /flushdns` 后直接推送。
- 还原纪律：改 hosts 前先 `Copy-Item` 备份到日志目录，收尾按备份还原并用 `-Raw` 比较确认逐字节一致（用正则替换改写会吞掉行尾 CR）。
- pre-push hook 会跑根 `bun turbo typecheck`；`bun.lock` 变更后是冷启动全量（约 3-4 分钟），重试预算要算上。

## 文档提交与 CI 触发过滤

`generate`、`typecheck`、`test` 三条工作流带有 `paths-ignore` 过滤：当一次 push 或 PR 的全部变更都命中过滤清单时，不会产生任何 CI run。纯文档提交查不到 run 属预期，不是漏跑，也不要手动补跑。

过滤清单（三条工作流的 push 与 pull_request 共六处需保持一致）：

- `docs/**`、`specs/**`、`openspec/**`：文档、规范与提案体系；
- `.agents/**`、`.claude/**`、`.kimi-code/**`、`.qoder/**`：各代理工具的纯文档目录，整目录忽略；
- `.opencode/**.md`：只忽略 markdown；其插件与工具脚本（ts/tsx/json）保持触发；
- `.github/**.md`：PR/issue 模板类文档；workflow 自身（yml）保持触发；
- `*.md`：根级 markdown（README / CONTEXT / SECURITY / STATS 等，`*` 不跨目录）；
- `**/README.md`、`**/AGENTS.md`：任意层级的 README 与 AGENTS 说明。

刻意没有使用 `**/*.md` 一刀切：`packages/` 内存在被运行时或测试读取的 markdown，误伤会让该跑的 CI 被跳过。以下文件不在过滤清单，修改后必须照常触发：

- `packages/core/src/plugin/skill/customize-opennovel.md`（以文本形式打进运行时）；
- `script/translate-app.md`（翻译脚本读取的提示词）；
- `packages/opennovel/test/config/fixtures/*.md`、`packages/opennovel/test/fixture/skills/**` 等测试夹具。

确认与补跑：

```powershell
# 某次推送的 run 数量：纯文档应为 0；含代码或工作流变更则不为 0
gh api "repos/MarsQiu007/openNovel/actions/runs?head_sha=<sha>" --jq '.total_count'

# 需要人工验证时走 dispatch（不受过滤影响；generate 暂未开放手动触发）
gh workflow run test.yml --ref main
```

维护规则：新增整片文档目录（新的代理工具目录、文档站点等）时，同步更新三条工作流的两个清单，并把目录补进本节。

## 时间预算

- `unit (linux)` 约 15-20 分钟（unit tests + generated client 校验 + HttpApi exerciser gates + technique e2e gates 四段）；`unit (windows)` 约 25-30 分钟；`e2e` 约 9 分钟；`generate` / `typecheck` 少于 2 分钟。
- 纯文档提交不产生任何 run（见「文档提交与 CI 触发过滤」），无需等待。

## 本机脚本要点（Windows/PowerShell）

- 长任务一律「脚本落盘 + 状态文件轮询」（`Start-Process powershell -File <脚本>`），不要依赖 `write_stdin` 的会话 id（常失效）；`exec` 类工具单次等待上限约 30 秒，长任务要靠轮询状态文件。
- 文本补丁拆小步：小改动用 `[IO.File]::ReadAllText/WriteAllText` + 锚点 `Replace`（换行/回车用 `[string][char]10`/`[string][char]13` 显式拼接，避免拼反引号）；较大的脚本补丁用 `bun <file>.cjs`（`readFileSync` + 锚点替换 + `writeFileSync`）。命令文本过长或含敏感系统路径 token 时易被策略拦截。
- PowerShell 5.1 没有 `??`；数组上 `-notmatch` 返回不匹配元素集合而不是布尔。
