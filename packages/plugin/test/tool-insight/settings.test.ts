import { describe, expect, test } from "bun:test"
import { join } from "path"
import {
  resolveToolInsightRoot,
  resolveToolInsightSetting,
  toolInsightProjectSlug,
  TOOL_INSIGHT_DEFAULT_SUBPATH,
  type ToolInsightConfigFile,
} from "../../src/tool-insight/settings"

function files(entries: Record<string, string | undefined>): ToolInsightConfigFile[] {
  return [
    { name: "config.json", text: entries["config.json"] },
    { name: "opennovel.json", text: entries["opennovel.json"] },
    { name: "opennovel.jsonc", text: entries["opennovel.jsonc"] },
  ]
}

describe("resolveToolInsightSetting", () => {
  test("无任何文件时缺省关闭且无警告", () => {
    const { setting, warning } = resolveToolInsightSetting(files({}))
    expect(setting).toEqual({ enabled: false })
    expect(warning).toBeUndefined()
  })

  test("文件存在但未配置 toolInsight 时同样缺省关闭", () => {
    const { setting, warning } = resolveToolInsightSetting(
      files({ "opennovel.json": JSON.stringify({ model: "anthropic/claude-2" }) }),
    )
    expect(setting).toEqual({ enabled: false })
    expect(warning).toBeUndefined()
  })

  test("解析 enabled 与显式目录", () => {
    const { setting, warning } = resolveToolInsightSetting(
      files({ "opennovel.jsonc": JSON.stringify({ toolInsight: { enabled: true, directory: "D:/novel-logs" } }) }),
    )
    expect(setting).toEqual({ enabled: true, directory: "D:/novel-logs" })
    expect(warning).toBeUndefined()
  })

  test("按 config.json → opennovel.json → opennovel.jsonc 由低到高整体覆盖", () => {
    const { setting } = resolveToolInsightSetting(
      files({
        "config.json": JSON.stringify({ toolInsight: { enabled: true, directory: "D:/low" } }),
        "opennovel.json": JSON.stringify({ toolInsight: { enabled: false } }),
        "opennovel.jsonc": JSON.stringify({ toolInsight: { enabled: true } }),
      }),
    )
    // 高优先级文件的完整声明覆盖低优先级，不保留低优先级的 directory
    expect(setting).toEqual({ enabled: true, directory: undefined })
  })

  test("支持 JSONC 注释与尾逗号", () => {
    const { setting } = resolveToolInsightSetting(
      files({
        "opennovel.jsonc": `{\n  // 工具改进日志\n  "toolInsight": { "enabled": true, },\n}`,
      }),
    )
    expect(setting).toEqual({ enabled: true, directory: undefined })
  })

  test("空目录串归一化为缺省目录语义", () => {
    const { setting } = resolveToolInsightSetting(
      files({ "opennovel.jsonc": JSON.stringify({ toolInsight: { enabled: true, directory: "  " } }) }),
    )
    expect(setting).toEqual({ enabled: true, directory: undefined })
  })

  test("任一相关文件语法错误时按未启用并给出警告，即使低优先级文件有效", () => {
    const { setting, warning } = resolveToolInsightSetting(
      files({
        "config.json": JSON.stringify({ toolInsight: { enabled: true } }),
        "opennovel.jsonc": "{ toolInsight: { enabled: true",
      }),
    )
    expect(setting).toEqual({ enabled: false })
    expect(warning).toContain("opennovel.jsonc")
  })

  test("toolInsight 字段类型非法时按未启用", () => {
    for (const raw of [JSON.stringify({ toolInsight: true }), JSON.stringify({ toolInsight: [] })]) {
      const { setting, warning } = resolveToolInsightSetting(files({ "opennovel.jsonc": raw }))
      expect(setting).toEqual({ enabled: false })
      expect(warning).toBeTruthy()
    }
  })

  test("enabled 非布尔或 directory 非字符串时按未启用", () => {
    for (const raw of [
      JSON.stringify({ toolInsight: { enabled: "yes" } }),
      JSON.stringify({ toolInsight: { enabled: 1 } }),
      JSON.stringify({ toolInsight: { enabled: true, directory: 3 } }),
    ]) {
      const { setting, warning } = resolveToolInsightSetting(files({ "opennovel.jsonc": raw }))
      expect(setting).toEqual({ enabled: false })
      expect(warning).toBeTruthy()
    }
  })

  test("解析结果只取决于传入文本：环境与远程来源不提供覆盖", () => {
    process.env.OPENNOVEL_CONFIG_TOOL_INSIGHT = JSON.stringify({ enabled: true })
    try {
      const { setting } = resolveToolInsightSetting(files({ "opennovel.json": JSON.stringify({}) }))
      expect(setting).toEqual({ enabled: false })
    } finally {
      delete process.env.OPENNOVEL_CONFIG_TOOL_INSIGHT
    }
  })

  test("纯函数无缓存：同一进程内不同输入得到不同结果", () => {
    const first = resolveToolInsightSetting(
      files({ "opennovel.jsonc": JSON.stringify({ toolInsight: { enabled: true } }) }),
    )
    const second = resolveToolInsightSetting(files({}))
    expect(first.setting.enabled).toBe(true)
    expect(second.setting.enabled).toBe(false)
  })

  test("plugin/plugins 数组成员不参与解析也不影响 toolInsight", () => {
    const { setting, warning } = resolveToolInsightSetting(
      files({
        "opennovel.jsonc": JSON.stringify({
          plugin: [{ type: "local", directory: "./plugins/extra" }],
          plugins: { novel: { enabled: true } },
          toolInsight: { enabled: true, directory: "D:/shared" },
        }),
      }),
    )
    expect(setting).toEqual({ enabled: true, directory: "D:/shared" })
    expect(warning).toBeUndefined()
  })
})

describe("resolveToolInsightRoot", () => {
  test("目录缺省或为空时解析到项目内默认子目录", () => {
    const expected = join("D:/books/a", TOOL_INSIGHT_DEFAULT_SUBPATH)
    for (const setting of [{ enabled: true }, { enabled: true, directory: "" }, { enabled: true, directory: "  " }]) {
      expect(resolveToolInsightRoot(setting, { projectDirectory: "D:/books/a", projectID: "p1" })).toBe(expected)
    }
    expect(TOOL_INSIGHT_DEFAULT_SUBPATH).toContain(".novel")
  })

  test("共享根目录按项目短哈希隔离且跨重启稳定", () => {
    const setting = { enabled: true, directory: "D:/shared-logs" }
    const first = resolveToolInsightRoot(setting, { projectDirectory: "D:/books/a", projectID: "project-alpha" })
    const second = resolveToolInsightRoot(setting, { projectDirectory: "D:/books/a", projectID: "project-alpha" })
    expect(first).toBe(second)
    const slug = toolInsightProjectSlug("project-alpha")
    expect(slug).toMatch(/^[0-9a-f]{12}$/)
    expect(first).toBe(join("D:/shared-logs", slug))
  })

  test("不同项目隔离到不同子目录且不泄露原标识", () => {
    const a = resolveToolInsightRoot({ enabled: true, directory: "D:/shared" }, { projectDirectory: "D:/a", projectID: "alpha" })
    const b = resolveToolInsightRoot({ enabled: true, directory: "D:/shared" }, { projectDirectory: "D:/b", projectID: "beta" })
    expect(a).not.toBe(b)
    expect(a).not.toContain("alpha")
    expect(b).not.toContain("beta")
  })
})
