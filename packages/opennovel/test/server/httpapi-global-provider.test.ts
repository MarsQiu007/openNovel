import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import { existsSync } from "fs"
import path from "path"
import { Global } from "@opennovel-ai/core/global"
import { Server } from "../../src/server/server"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

function app() {
  return Server.Default().app
}

function request(providerID: string, init: { method: string; body?: string }) {
  return app().request(`/global/config/provider/${providerID}`, {
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

// 全局配置文件存在与否决定写回格式：无文件时按 globalConfigFile 约定新建 opennovel.jsonc，
// 内容是纯 JSON（无注释），直接 JSON.parse 即可断言
const savedConfig = async (dir: string) => {
  const jsonc = path.join(dir, "opennovel.jsonc")
  return JSON.parse(await Bun.file(existsSync(jsonc) ? jsonc : path.join(dir, "opennovel.json")).text())
}

describe("global provider HttpApi", () => {
  test("PUT wholesale-replaces provider config leaving no stale models or headers", async () => {
    await using tmp = await tmpdir()
    ;(Global.Path as { config: string }).config = tmp.path

    const first = {
      npm: "@ai-sdk/openai-compatible",
      name: "Acme",
      options: { baseURL: "https://acme.example/v1", headers: { "x-old": "1" } },
      models: { "old-a": { name: "Old A" }, "old-b": { name: "Old B" } },
    }
    let response = await request("acme", { method: "PUT", body: JSON.stringify(first) })
    expect(response.status).toBe(200)
    expect(await response.json()).toBe(true)
    // 全新环境无配置文件：按约定新建 opennovel.jsonc（.jsonc 分支）
    expect(existsSync(path.join(tmp.path, "opennovel.jsonc"))).toBe(true)

    // 整体覆盖：第二次提交只保留 new-c，旧模型行与旧 header 键必须被清掉
    const replacement = {
      npm: "@ai-sdk/openai-compatible",
      name: "Acme 2",
      options: { baseURL: "https://acme.example/v1" },
      models: { "new-c": { name: "New C", limit: { context: 131072, output: 8192 }, reasoning: true } },
    }
    response = await request("acme", { method: "PUT", body: JSON.stringify(replacement) })
    expect(response.status).toBe(200)

    const saved = await savedConfig(tmp.path)
    expect(saved.provider.acme.name).toBe("Acme 2")
    expect(Object.keys(saved.provider.acme.models)).toEqual(["new-c"])
    expect(saved.provider.acme.models["new-c"].limit).toEqual({ context: 131072, output: 8192 })
    expect(saved.provider.acme.models["new-c"].reasoning).toBe(true)
    expect(saved.provider.acme.options.headers).toBeUndefined()
  })

  test("PUT re-enables a disabled provider and drops empty list keys", async () => {
    await using tmp = await tmpdir()
    ;(Global.Path as { config: string }).config = tmp.path
    await Bun.write(
      path.join(tmp.path, "opennovel.json"),
      JSON.stringify({
        provider: { acme: { npm: "@ai-sdk/openai-compatible", models: { "old-a": {} } } },
        disabled_providers: ["acme", "other"],
      }),
    )

    const next = {
      npm: "@ai-sdk/openai-compatible",
      name: "Acme",
      options: { baseURL: "https://acme.example/v1" },
      models: { "new-c": { name: "New C" } },
    }
    const response = await request("acme", { method: "PUT", body: JSON.stringify(next) })
    expect(response.status).toBe(200)

    const saved = await savedConfig(tmp.path)
    expect(saved.provider.acme.models).toEqual({ "new-c": { name: "New C" } })
    // acme 被移出禁用名单；过滤后非空保留 other，不留下 []
    expect(saved.disabled_providers).toEqual(["other"])
  })

  test("PUT on a fully disabled provider deletes the empty disabled_providers key", async () => {
    await using tmp = await tmpdir()
    ;(Global.Path as { config: string }).config = tmp.path
    await Bun.write(
      path.join(tmp.path, "opennovel.json"),
      JSON.stringify({
        provider: { acme: { npm: "@ai-sdk/openai-compatible", models: { "old-a": {} } } },
        disabled_providers: ["acme"],
      }),
    )

    const response = await request("acme", {
      method: "PUT",
      body: JSON.stringify({ npm: "@ai-sdk/openai-compatible", name: "Acme", models: { "new-c": {} } }),
    })
    expect(response.status).toBe(200)

    const saved = await savedConfig(tmp.path)
    expect(saved.disabled_providers).toBeUndefined()
  })

  test("DELETE scrubs provider config, list residue and stored credentials", async () => {
    await using tmp = await tmpdir()
    ;(Global.Path as { config: string }).config = tmp.path

    // 凭据文件路径在模块加载时已固化到测试数据目录（preload 重定向过 XDG），这里直接播种
    const authFile = path.join(Global.Path.data, "auth.json")
    const previous = existsSync(authFile) ? await Bun.file(authFile).text() : undefined
    try {
      await Bun.write(authFile, JSON.stringify({ acme: { type: "api", key: "sk-secret" } }))

      await Bun.write(
        path.join(tmp.path, "opennovel.json"),
        JSON.stringify({
          provider: {
            acme: { npm: "@ai-sdk/openai-compatible", models: { "old-a": {} } },
            other: { npm: "@ai-sdk/openai-compatible", models: { "keep-me": {} } },
          },
          disabled_providers: ["acme"],
          enabled_providers: ["acme"],
        }),
      )

      const response = await request("acme", { method: "DELETE" })
      expect(response.status).toBe(200)
      expect(await response.json()).toBe(true)

      const saved = await savedConfig(tmp.path)
      expect(saved.provider.acme).toBeUndefined()
      expect(saved.provider.other).toBeDefined()
      // 过滤后为空的名单删键而不是留 [] 残留
      expect(saved.disabled_providers).toBeUndefined()
      expect(saved.enabled_providers).toBeUndefined()

      const auth = JSON.parse(await Bun.file(authFile).text())
      expect(auth.acme).toBeUndefined()
    } finally {
      if (previous === undefined) await fs.rm(authFile, { force: true })
      else await Bun.write(authFile, previous)
    }
  })
})
