import { describe, expect, test } from "bun:test"
import { isLocalWorkspaceRoute, workspaceProxyURL } from "../../src/server/shared/workspace-routing"

describe("isLocalWorkspaceRoute", () => {
  test("/experimental/workspace is local", () => {
    expect(isLocalWorkspaceRoute("GET", "/experimental/workspace")).toBe(true)
  })

  test("/experimental/workspace subpaths are local (prefix match)", () => {
    expect(isLocalWorkspaceRoute("POST", "/experimental/workspace/ws_abc")).toBe(true)
  })

  test("unrecognized paths are not local", () => {
    expect(isLocalWorkspaceRoute("GET", "/config")).toBe(false)
    expect(isLocalWorkspaceRoute("GET", "/session")).toBe(false)
    expect(isLocalWorkspaceRoute("POST", "/api/session")).toBe(false)
  })
})

describe("workspaceProxyURL", () => {
  test("appends request path to target", () => {
    const result = workspaceProxyURL("http://remote:8080/base", new URL("http://localhost/config"))
    expect(result.toString()).toBe("http://remote:8080/base/config")
  })

  test("strips trailing slash on target before appending", () => {
    const result = workspaceProxyURL("http://remote:8080/base/", new URL("http://localhost/session/abc"))
    expect(result.pathname).toBe("/base/session/abc")
  })

  test("preserves query params from request but removes workspace", () => {
    const url = new URL("http://localhost/config?workspace=ws_123&keep=yes")
    const result = workspaceProxyURL("http://remote:8080/base", url)
    expect(result.searchParams.get("workspace")).toBeNull()
    expect(result.searchParams.get("keep")).toBe("yes")
  })

  test("preserves hash from request", () => {
    const url = new URL("http://localhost/page#section")
    const result = workspaceProxyURL("http://remote:8080", url)
    expect(result.hash).toBe("#section")
  })

  test("works with URL object as target", () => {
    const target = new URL("http://remote:3000/api")
    const result = workspaceProxyURL(target, new URL("http://localhost/users"))
    expect(result.toString()).toBe("http://remote:3000/api/users")
  })
})
