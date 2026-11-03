import { describe, expect, test } from "bun:test"
import { AgentV2 } from "@opennovel-ai/core/agent"
import { Config } from "../src/config"
import { ConfigAgent } from "../src/config/agent"
import { ConfigPermission } from "../src/config/permission"
import { selectModel } from "../src/permission/judge"
import { PermissionPolicy } from "../src/permission/policy"

const agent = (policy?: Record<string, PermissionPolicy.Policy>, mode?: PermissionPolicy.Mode) =>
  new ConfigPermission.Info({ mode, policy })

describe("PermissionPolicy.resolve", () => {
  test("agent 级覆盖项目级与默认表", () => {
    expect(PermissionPolicy.resolve("bash", agent({ bash: "ask" }), agent({ bash: "allow" }))).toBe("ask")
  })

  test("项目级覆盖默认表", () => {
    expect(PermissionPolicy.resolve("bash", undefined, agent({ bash: "allow" }))).toBe("allow")
  })

  test("默认表逐档", () => {
    for (const action of ["bash", "edit", "write", "apply_patch", "webfetch", "websearch", "browser", "skill", "codemode"])
      expect(PermissionPolicy.resolve(action)).toBe("judge")
    for (const action of ["read", "glob", "grep", "question", "todowrite"])
      expect(PermissionPolicy.resolve(action)).toBe("allow")
    expect(PermissionPolicy.resolve("subagent")).toBe("ask")
  })

  test("未列动作回落 ask", () => {
    expect(PermissionPolicy.resolve("mcp_some_server")).toBe("ask")
  })
})

describe("PermissionPolicy.resolveMode", () => {
  test("缺省 ask", () => {
    expect(PermissionPolicy.resolveMode(undefined, undefined)).toBe("ask")
  })

  test("用户级生效：全局 judge 无项目级时保持 judge", () => {
    expect(PermissionPolicy.resolveMode("judge", undefined)).toBe("judge")
  })

  test("项目级放松被忽略：全局 ask + 项目 judge 回落 ask", () => {
    expect(PermissionPolicy.resolveMode("ask", "judge")).toBe("ask")
  })

  test("项目级收严生效：全局 judge + 项目 ask 按 ask", () => {
    expect(PermissionPolicy.resolveMode("judge", "ask")).toBe("ask")
  })

  test("影子档同样只在收严方向生效", () => {
    expect(PermissionPolicy.resolveMode("ask", "judge-shadow")).toBe("ask")
    expect(PermissionPolicy.resolveMode("judge", "judge-shadow")).toBe("judge-shadow")
  })
})

describe("PermissionPolicy.agentConfig", () => {
  const doc = (path: string, agents: Config.Info["agents"]): Config.Document =>
    new Config.Document({ type: "document", path, info: new Config.Info({ agents }) })

  test("取最高优先级文档中该 agent 的 permission 段", () => {
    const entries: Config.Entry[] = [
      doc("/global/opennovel.json", { coder: new ConfigAgent.Info({ permission: new ConfigPermission.Info({ mode: "ask" }) }) }),
      doc("/project/opennovel.json", { coder: new ConfigAgent.Info({ permission: new ConfigPermission.Info({ mode: "judge" }) }) }),
    ]
    expect(PermissionPolicy.agentConfig(entries, AgentV2.ID.make("coder"))?.mode).toBe("judge")
  })

  test("无 agent 定义返回 undefined", () => {
    expect(PermissionPolicy.agentConfig([], AgentV2.ID.make("coder"))).toBeUndefined()
  })
})

describe("Config.latestScoped", () => {
  const GLOBAL_DIR = "/home/user/.config/opennovel"
  const permissionDoc = (path: string | undefined, mode: string): Config.Document =>
    new Config.Document({
      type: "document",
      path,
      info: new Config.Info({ permission: new ConfigPermission.Info({ mode: mode as never }) }),
    })

  test("按目录区分全局与项目定义，各取最后一个", () => {
    const entries: Config.Entry[] = [
      permissionDoc(`${GLOBAL_DIR}/opennovel.json`, "ask"),
      permissionDoc("/project/opennovel.json", "judge"),
      permissionDoc("/project/.opennovel/opennovel.json", "judge-shadow"),
    ]
    const scoped = Config.latestScoped(entries, "permission", GLOBAL_DIR)
    expect(scoped.user?.mode).toBe("ask")
    expect(scoped.project?.mode).toBe("judge-shadow")
  })

  test("仅全局定义时 project 为空", () => {
    const scoped = Config.latestScoped([permissionDoc(`${GLOBAL_DIR}/opennovel.json`, "judge")], "permission", GLOBAL_DIR)
    expect(scoped.user?.mode).toBe("judge")
    expect(scoped.project).toBeUndefined()
  })

  test("无 path 文档归项目级", () => {
    const scoped = Config.latestScoped([permissionDoc(undefined, "ask")], "permission", GLOBAL_DIR)
    expect(scoped.user).toBeUndefined()
    expect(scoped.project?.mode).toBe("ask")
  })
})

describe("PermissionJudge.selectModel", () => {
  const available = [
    { providerID: "anthropic", id: "claude" },
    { providerID: "openrouter", id: "gpt-5" },
  ]

  test("已配置引用按 provider/model 命中", () => {
    expect(selectModel("openrouter/gpt-5", { providerID: "anthropic", id: "claude" }, available)).toEqual({
      providerID: "openrouter",
      id: "gpt-5",
    })
  })

  test("空串等同未配置：回落跟随会话模型", () => {
    expect(selectModel("", { providerID: "anthropic", id: "claude" }, available)).toEqual({
      providerID: "anthropic",
      id: "claude",
    })
  })

  test("未配置时跟随会话模型", () => {
    expect(selectModel(undefined, { providerID: "openrouter", id: "gpt-5" }, available)).toEqual({
      providerID: "openrouter",
      id: "gpt-5",
    })
  })

  test("配置引用未命中与会话模型都缺省时返回 undefined（调用方回落默认模型）", () => {
    expect(selectModel("unknown/model", undefined, available)).toBeUndefined()
    expect(selectModel(undefined, undefined, available)).toBeUndefined()
  })
})
