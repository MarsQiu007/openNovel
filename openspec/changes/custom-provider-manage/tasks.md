# Tasks

## 1. 协议端点与再生成

- [x] 1.1 GlobalApi 组（opennovel/src/server/routes/instance/httpapi/groups/global.ts）新增 `PUT /global/config/provider/:providerID`（路径常量入 `GlobalPaths`，params 用 `ProviderV2.ID`，payload `ConfigProviderV1.Info`，success Boolean）与 `DELETE /global/config/provider/:providerID`（success Boolean）两个端点，按既有 OpenApi annotations 惯例补 identifier/summary/description
  - 验证：`bun typecheck`（packages/opennovel）通过
- [x] 1.2 Config 服务（opennovel/src/config/config.ts）新增 provider 整体覆盖/删除方法，返回与 `updateGlobal` 同形的 `{ info, changed }`：覆盖 = `provider[id]` 整体替换 + 从 `disabled_providers` 移除该 id；删除 = 移除 `provider[id]` + 从 `disabled_providers`/`enabled_providers` 滤除；.json 路径读改写内存对象后 `JSON.stringify` 写回，.jsonc 路径复用 `patchJsonc`（删除子树发 undefined 编辑、覆盖先删子树再整体写入、数组发替换编辑）；写回后走既有 `invalidate()`
  - 验证：在 `packages/opennovel/test/config.test.ts`（或就近新建用例文件）覆盖 .json 与 .jsonc 两格式的覆盖/删除/禁启用清理组合，`bun test`（packages/opennovel）通过
- [x] 1.3 handlers/global.ts 新增两端点处理器，与 configUpdate 处理器（handlers/global.ts:86-90）同构：`changed` 为真则 `bridge.fork(disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true }))` 触发运行实例重载；DELETE 处理器额外 `yield* Auth.Service` 调 `auth.remove(providerID)`（参照 handlers/control.ts 既有用法）
  - 验证：`bun typecheck`（packages/opennovel）通过
- [x] 1.4 从仓库根运行 `bun ./script/generate.ts` 完成双产物再生成（SDK gen 与 openapi.json，禁止手改 generated）
  - 验证：再生成后 `git status` 仅出现预期产物 diff；CI generate 工作流绿灯复核

## 2. 对话框编辑模式与删除

- [x] 2.1 `dialog-custom-provider-form.ts`：`CustomProviderForm` 支持 `mode: "create" | "edit"` 与预填入参（id 锁定；name/baseURL/headers/models 从持久化配置回读；`env` 数组回显为 apiKey 框的 `{env:VAR}` 语法；apiKey 值不回显、留空即保留）；`validateCustomProvider` 按模式跳过 edit 的「ID 已存在」分支；结果序列化保持「留空不写出键」纪律（新增细节字段同纪律）
  - 验证：表单模块纯函数单测覆盖 create 校验不变、edit 同 ID 通过、预填往返（serialize(parse(x)) ⊇ x，含 env 语法与细节字段）
- [x] 2.2 `dialog-custom-provider.tsx`：接 `mode` 与 `providerID` props；edit 保存走 `PUT provider/:id`（apiKey 非空才追加 `authSet`，留空不动凭据），create 同步切到该 PUT 端点（替代原 PATCH updateConfig 写 provider 与 `disabled_providers` 的两段式，「保存即启用」由服务端 PUT 内建）；成功后失效 provider 查询（沿用 updateConfigMutation.onSuccess 的 queryClient invalidate 套路）
  - 验证：app typecheck 通过；保存路径单测/既有测试适配
- [x] 2.3 编辑对话框内新增删除按钮（红色、二次确认），确认后调 `DELETE provider/:id` 并关闭对话框、失效 provider 查询
  - 验证：app typecheck 通过

## 3. 模型细节配置

- [x] 3.1 模型行增加可展开细节区（展开态为本地信号）：数字输入 `limit.context`/`limit.output`/`limit.input`、`cost.input`/`cost.output`；开关 `reasoning`/`interleaved`/`temperature`/`tool_call`/`attachment`；下拉 `status`；文本 `family`；序列化仅写已填/已开键（`interleaved` 只写布尔）
  - 验证：序列化单测覆盖全填/部分填/全空三态的输出键集合
- [x] 3.2 三语文案落 `packages/app/src/i18n/{en,zh,zht}.ts` 的 `provider.custom.*` 命名空间（该对话框既有文案位，跟随近期 feature 提交先例），补齐细节区字段标签与删除确认文案
  - 验证：三语字典键对齐（en 定义、zh/zht 同键），app typecheck 通过

## 4. 列表入口与收尾验证

- [x] 4.1 `settings-providers.tsx` 自定义区行新增「编辑」按钮（打开 edit 模式对话框）；行上保留既有「断开」；确认自定义区判定（`isConfigCustom`）对新保存记录仍成立
  - 验证：app typecheck 通过
- [x] 4.2 受影响包（opennovel、app、sdk）分别 `bun typecheck`、`bun test`；从仓库根按既定方式跑 oxlint 并与 main 基线同模式对比
  - 验证：全绿；oxlint 逐文件警告数零新增
  - 验证记录（2026-11-03）：opennovel/app/sdk 三个包 `bun typecheck` 全绿；app 套件 932 pass（bunx bun@1.3.14）；opennovel 全量套件 1693 pass / 31 skip / 1 fail，唯一失败为 `test/config/config.test.ts` 的「loads project config from Git Bash and MSYS2 paths on Windows」5s 超时——命中既有 5s 超时 flake 家族，与本次 diff 无关（该用例走 Git Bash/MSYS2 路径加载，不触改动面），单文件复跑 105 pass 全绿；oxlint 逐文件对比 main 零新增（config.ts/config.test.ts 各 0=0，新测试文件 0 告警）
- [x] 4.3 非视觉验收自证：用 httpapi 练习或单测断言「PUT 整体覆盖后旧模型行/旧 header 键已清除」「DELETE 后 config.provider 无键、disabled/enabled 无残留、凭据双库无条目」，结论写入 tasks 验证记录
  - 验证：断言输出入档
  - 验证记录（2026-11-03）：新增 `packages/opennovel/test/server/httpapi-global-provider.test.ts`（4 用例，经 `Server.Default().app` 真实走 HTTP 栈）+ Config 服务单测补 2 用例，全部通过——
    - PUT 整体覆盖：第二次提交仅留 new-c 后，落盘 `provider.acme.models` 键集合恰为 `["new-c"]`、`options.headers` 旧键消失、细节字段（limit 数值对/reasoning）落盘正确；
    - PUT 保存即启用：disabled 名单含 `["acme","other"]` 时保存后落盘为 `["other"]`；仅含 `["acme"]` 时键整体删除不留 `[]`；
    - DELETE：落盘 `config.provider` 无 acme 键（other 保留）、disabled/enabled 名单无残留（空则删键）；`auth.json` 中 acme 凭据被清除；
    - 修复并守护一个验收中发现的真 bug：全新环境无配置文件时 `globalConfigFile()` 回退到 `opennovel.jsonc`，`.jsonc` 分支对缺失键发删除会触发 jsonc-parser「Can not delete in empty document」致 PUT/DELETE 500——现已按「键存在才发删除补丁」修正，并由「无文件创建/无文件删除不变」两个单测守护。

## Workflow follow-up

- 实现提交统一带 `OpenSpec-Change: custom-provider-manage` trailer；完成后 validate → archive（`npx openspec archive --yes`）→ 合并推送 main → 按新沉淀规则确认 CI 全绿再清理分支
