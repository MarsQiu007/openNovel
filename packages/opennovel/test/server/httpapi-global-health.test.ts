import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Global } from "@opennovel-ai/core/global"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

function request(pathname: string, init: { method: string; body?: string }) {
  return Server.Default().app.request(pathname, {
    ...init,
    headers: { "content-type": "application/json" },
  })
}

// Global.Path.config 在请求处理时实时读取（globalConfigFile），逐测试覆盖到临时目录
const originalConfigDir = Global.Path.config

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
  ;(Global.Path as { config: string }).config = originalConfigDir
})

describe("global config health HttpApi", () => {
  // 2026-11-05 CI flake（run 42015932786）的决定性复现：缓存已填充后服务外直写配置文件，
  // 旧实现经 getGlobal 缓存读取对新漂移不可见 → agent-model:ghost 漏报；直读后必须报告
  test("reports drift introduced by direct file edits after the config cache is populated", async () => {
    await using tmp = await tmpdir()
    ;(Global.Path as { config: string }).config = tmp.path
    await Bun.write(path.join(tmp.path, "opennovel.jsonc"), JSON.stringify({ username: "cached" }))

    // 先经 API 读取全局配置，填充进程内缓存（后续直写不走服务、不触发失效）
    const warm = await request("/global/config", { method: "GET" })
    expect(warm.status).toBe(200)

    // 服务外直写：引入指向未知提供商的 agent 模型覆盖（用户手改/跨机覆盖形态）
    await Bun.write(
      path.join(tmp.path, "opennovel.jsonc"),
      JSON.stringify({ agent: { ghost: { model: "ghostprovider/ghost-1" } } }),
    )

    const response = await request("/global/config/health", { method: "GET" })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "agent-model:ghost" })]),
    )
  })
})
