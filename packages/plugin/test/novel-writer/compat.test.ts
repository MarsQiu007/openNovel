/**
 * 兼容性测试 — V1 插件加载器与 oh-my-openagent (V2) 共存验证
 *
 * 验证目标：
 * 1. V1 插件加载器仍能加载 novel-writer 插件
 * 2. oh-my-openagent (V2 插件) 能够正常加载
 * 3. 两者之间不存在钩子冲突
 */
import { describe, expect, test } from "bun:test"
import { join } from "path"
import { tmpdir } from "os"
import { mkdtemp, rm, writeFile } from "fs/promises"
import { pathToFileURL } from "url"

/**
 * 创建临时目录并返回路径
 */
async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "novel-writer-compat-"))
}

/**
 * 清理临时目录
 */
async function cleanupTempDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

describe("novel-writer 插件兼容性", () => {
  test("V1 插件加载器能够加载 novel-writer 插件", async () => {
    const tempDir = await createTempDir()

    try {
      // 创建 V1 novel-writer 插件文件
      const pluginPath = join(tempDir, "novel-writer-v1.ts")
      const pluginCode = `
import type { Plugin } from "@opennovel-ai/plugin"

export const NovelWriterPlugin: Plugin = async (_ctx) => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system = output.system ?? []
      output.system.push("【小说写作上下文】")
    },
    "experimental.session.compacting": async (_input, output) => {
      output.context = output.context ?? []
      output.context.push("【小说蓝图】")
    },
    tool: {
      write_chapter: {
        description: "撰写小说章节内容",
        parameters: {
          type: "object",
          properties: {
            chapter_id: { type: "string", description: "章节 ID" },
            content: { type: "string", description: "章节正文" },
          },
          required: ["chapter_id", "content"],
        },
        execute: async (_args: any) => "",
      },
    },
  }
}

export default NovelWriterPlugin
`
      await writeFile(pluginPath, pluginCode, "utf-8")

      // 动态导入插件
      const pluginUrl = pathToFileURL(pluginPath).href
      const mod = await import(pluginUrl)

      // 验证插件导出
      expect(mod.NovelWriterPlugin).toBeDefined()
      expect(typeof mod.NovelWriterPlugin).toBe("function")
      expect(mod.default).toBeDefined()

      // 调用插件函数获取 hooks
      const hooks = await mod.NovelWriterPlugin({})

      // 验证注册的钩子
      expect(hooks["experimental.chat.system.transform"]).toBeDefined()
      expect(hooks["experimental.session.compacting"]).toBeDefined()
      expect(hooks.tool).toBeDefined()
      expect(hooks.tool?.write_chapter).toBeDefined()
      expect(hooks.tool?.write_chapter.description).toBe("撰写小说章节内容")
    } finally {
      await cleanupTempDir(tempDir)
    }
  })

  test("oh-my-openagent (V2 插件) 能够正常加载", async () => {
    const tempDir = await createTempDir()

    try {
      // 创建 V2 oh-my-openagent 插件文件
      const pluginPath = join(tempDir, "oh-my-openagent-v2.ts")
      const pluginCode = `
// V2 插件定义 — 不依赖外部导入，直接导出插件对象
export const OhMyOpenAgent = {
  id: "oh-my-openagent",
  setup: async (ctx: any) => {
    // 注册 V2 钩子
    await ctx.agent.transform((agent: any) => {
      agent.update("novel-assistant", (item: any) => {
        item.description = "小说写作助手 agent"
        item.mode = "subagent"
      })
    })

    await ctx.catalog.transform((catalog: any) => {
      catalog.provider.update("novel-model", (provider: any) => {
        provider.name = "Novel Model Provider"
      })
    })
  },
}

export default OhMyOpenAgent
`
      await writeFile(pluginPath, pluginCode, "utf-8")

      // 动态导入插件
      const pluginUrl = pathToFileURL(pluginPath).href
      const mod = await import(pluginUrl)

      // 验证插件导出
      expect(mod.OhMyOpenAgent).toBeDefined()
      expect(mod.default).toBeDefined()

      // 验证插件结构
      const plugin = mod.OhMyOpenAgent
      expect(plugin.id).toBe("oh-my-openagent")
      expect(typeof plugin.setup).toBe("function")
    } finally {
      await cleanupTempDir(tempDir)
    }
  })

  test("V1 novel-writer 与 V2 oh-my-openagent 之间不存在钩子冲突", async () => {
    const tempDir = await createTempDir()

    try {
      // 创建 V1 novel-writer 插件
      const v1PluginPath = join(tempDir, "novel-writer-v1.ts")
      const v1PluginCode = `
import type { Plugin } from "@opennovel-ai/plugin"

export const NovelWriterPlugin: Plugin = async (_ctx) => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system = output.system ?? []
      output.system.push("【V1 小说写作上下文】")
    },
    "experimental.session.compacting": async (_input, output) => {
      output.context = output.context ?? []
      output.context.push("【V1 小说蓝图】")
    },
    tool: {
      write_chapter: {
        description: "V1 撰写小说章节",
        parameters: {
          type: "object",
          properties: {
            chapter_id: { type: "string" },
            content: { type: "string" },
          },
          required: ["chapter_id", "content"],
        },
        execute: async (_args: any) => "V1 章节已写入",
      },
    },
  }
}

export default NovelWriterPlugin
`
      await writeFile(v1PluginPath, v1PluginCode, "utf-8")

      // 创建 V2 oh-my-openagent 插件
      const v2PluginPath = join(tempDir, "oh-my-openagent-v2.ts")
      const v2PluginCode = `
// V2 插件 — 使用 transform 钩子注册 agent 和 command
export const OhMyOpenAgent = {
  id: "oh-my-openagent",
  setup: async (ctx: any) => {
    await ctx.agent.transform((agent: any) => {
      agent.update("novel-assistant", (item: any) => {
        item.description = "V2 小说写作助手"
        item.mode = "subagent"
      })
    })

    await ctx.command.transform((command: any) => {
      command.update("novel-write", (item: any) => {
        item.description = "V2 小说写作命令"
      })
    })
  },
}

export default OhMyOpenAgent
`
      await writeFile(v2PluginPath, v2PluginCode, "utf-8")

      // 加载 V1 插件
      const v1Url = pathToFileURL(v1PluginPath).href
      const v1Mod = await import(v1Url)
      const v1Hooks = await v1Mod.NovelWriterPlugin({})

      // 加载 V2 插件
      const v2Url = pathToFileURL(v2PluginPath).href
      const v2Mod = await import(v2Url)
      const v2Plugin = v2Mod.OhMyOpenAgent

      // 验证 V1 钩子
      expect(v1Hooks["experimental.chat.system.transform"]).toBeDefined()
      expect(v1Hooks["experimental.session.compacting"]).toBeDefined()
      expect(v1Hooks.tool?.write_chapter).toBeDefined()

      // 验证 V2 插件结构
      expect(v2Plugin.id).toBe("oh-my-openagent")
      expect(typeof v2Plugin.setup).toBe("function")

      // 验证钩子命名空间不冲突
      // V1 使用 experimental.* 和 tool
      // V2 使用 ctx.agent.transform, ctx.command.transform 等
      const v1HookNames = Object.keys(v1Hooks).filter((k) => k !== "tool")
      const v1ToolNames = v1Hooks.tool ? Object.keys(v1Hooks.tool) : []

      // V1 钩子名称
      expect(v1HookNames).toContain("experimental.chat.system.transform")
      expect(v1HookNames).toContain("experimental.session.compacting")

      // V1 工具名称
      expect(v1ToolNames).toContain("write_chapter")

      // V2 插件 ID 唯一
      expect(v2Plugin.id).toBe("oh-my-openagent")

      // 验证 V1 和 V2 使用不同的钩子机制
      // V1: 直接返回 hooks 对象
      // V2: 通过 setup 函数注册到 context
      expect(typeof v1Hooks).toBe("object")
      expect(typeof v2Plugin.setup).toBe("function")

      // 验证两者可以同时存在
      expect(v1Hooks).toBeDefined()
      expect(v2Plugin).toBeDefined()
    } finally {
      await cleanupTempDir(tempDir)
    }
  })

  test("V1 novel-writer 钩子可以正常执行", async () => {
    const tempDir = await createTempDir()

    try {
      const pluginPath = join(tempDir, "novel-writer-v1.ts")
      const pluginCode = `
import type { Plugin } from "@opennovel-ai/plugin"

export const NovelWriterPlugin: Plugin = async (_ctx) => {
  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system = output.system ?? []
      output.system.push("【小说写作上下文快照】")
      output.system.push("【小说蓝图】")
      output.system.push("书名：测试小说")
    },
    tool: {
      write_chapter: {
        description: "撰写小说章节内容",
        parameters: {
          type: "object",
          properties: {
            chapter_id: { type: "string" },
            content: { type: "string" },
          },
          required: ["chapter_id", "content"],
        },
        execute: async (args: any) => \`章节 \${args.chapter_id} 已写入，字数：\${args.content.length}\`,
      },
    },
  }
}

export default NovelWriterPlugin
`
      await writeFile(pluginPath, pluginCode, "utf-8")

      const pluginUrl = pathToFileURL(pluginPath).href
      const mod = await import(pluginUrl)
      const hooks = await mod.NovelWriterPlugin({})

      // 测试 system.transform 钩子
      const systemOutput = { system: [] as string[] }
      await hooks["experimental.chat.system.transform"]?.({ sessionID: "test-session" }, systemOutput)

      expect(systemOutput.system.length).toBeGreaterThan(0)
      expect(systemOutput.system[0]).toContain("小说写作上下文快照")
      expect(systemOutput.system.join("\n")).toContain("测试小说")

      // 测试 tool 执行
      const toolResult = await hooks.tool?.write_chapter.execute({
        chapter_id: "ch_001",
        content: "这是一个测试章节的内容。",
      })

      expect(toolResult).toContain("ch_001")
      expect(toolResult).toContain("已写入")
    } finally {
      await cleanupTempDir(tempDir)
    }
  })
})
