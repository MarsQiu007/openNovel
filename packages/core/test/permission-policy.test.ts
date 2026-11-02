import { describe, expect, test } from "bun:test"
import { ConfigPermission } from "../src/config/permission"
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

describe("PermissionPolicy.mode", () => {
  test("缺省 ask", () => {
    expect(PermissionPolicy.mode()).toBe("ask")
  })

  test("agent 级覆盖项目级", () => {
    expect(PermissionPolicy.mode(agent(undefined, "judge"), agent(undefined, "judge-shadow"))).toBe("judge")
  })
})
