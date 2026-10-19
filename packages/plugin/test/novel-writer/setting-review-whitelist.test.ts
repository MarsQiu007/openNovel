import { describe, test, expect } from "bun:test"
import type { OrganizeEntity, OrganizeOperation } from "../../src/novel-writer/setting-reorganization.js"
import {
  classifyAutoExecution,
  isCategoryNormalizeUpdate,
  isFormatOnlyUpdate,
} from "../../src/novel-writer/setting-review-whitelist.js"

// 分级自动化白名单（design D3）：只有纯格式修复与非标准分类归一可自动执行。

function entity(partial: Partial<OrganizeEntity> = {}): OrganizeEntity {
  return {
    entity_type: "world_entry",
    id: "w-1",
    category: "地理",
    title: "青云宗",
    content: "",
    description: "",
    name: "",
    role: "",
    status: "active",
    state: "",
    char_a_id: "",
    char_b_id: "",
    relationship_type: "",
    ...partial,
  }
}

describe("白名单内：纯格式修复", () => {
  test("长段落拆分（仅分段差异）判为 format", () => {
    const before = entity({ content: "张三出身青云宗。少年时天赋异禀。后来拜入内门。" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { content: "张三出身青云宗。\n\n少年时天赋异禀。\n\n后来拜入内门。" },
      reason: "长段落自动按句末分段",
    }
    expect(classifyAutoExecution(operation, before)).toBe("format")
  })

  test("Markdown 残留清理判为 format", () => {
    const before = entity({ content: "青云宗位于东洲。## 历史沿革 **创派祖师**为张三。\n- 弟子三千 [详情](https://example.com)" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { content: "青云宗位于东洲。\n\n历史沿革\n\n创派祖师为张三。\n\n弟子三千 详情" },
      reason: "清理 Markdown 残留",
    }
    expect(classifyAutoExecution(operation, before)).toBe("format")
  })

  test("character 只改 description 也走 format 判定", () => {
    const before = entity({ entity_type: "character", id: "c-1", title: "林天", content: "", description: "林天性格沉稳。行事谨慎但从不轻敌。" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "character",
      id: "c-1",
      fields: { description: "林天性格沉稳。\n\n行事谨慎但从不轻敌。" },
      reason: "分段规范化",
    }
    expect(classifyAutoExecution(operation, before)).toBe("format")
  })
})

describe("白名单外：格式修复的豁免边界", () => {
  test("改写事实（换词）不判 format", () => {
    const before = entity({ content: "张三出身青云宗。" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { content: "张三出身天剑宗。" },
      reason: "语义改写",
    }
    expect(classifyAutoExecution(operation, before)).toBe(null)
  })

  test("删除句子不判 format", () => {
    const before = entity({ content: "张三出身青云宗。少年时天赋异禀。" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { content: "张三出身青云宗。" },
      reason: "删减",
    }
    expect(isFormatOnlyUpdate(operation, before)).toBe(false)
  })

  test("触碰 title 不判 format", () => {
    const before = entity({ content: "张三出身青云宗。" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { title: "青云剑宗", content: "张三出身青云宗。" },
      reason: "改名",
    }
    expect(classifyAutoExecution(operation, before)).toBe(null)
  })

  test("同时改 content 与 category 不判 format", () => {
    const before = entity({ category: "重要设定", content: "张三出身青云宗。" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { category: "势力", content: "张三出身青云宗。" },
      reason: "混合",
    }
    expect(classifyAutoExecution(operation, before)).toBe(null)
  })

  test("实体类型与目标不一致不判 format", () => {
    const before = entity({ content: "张三出身青云宗。" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "character",
      id: "w-1",
      fields: { description: "张三出身青云宗。" },
      reason: "错位",
    }
    expect(classifyAutoExecution(operation, before)).toBe(null)
  })
})

describe("白名单内：分类归一", () => {
  test("非标准分类归一到标准分类判为 category", () => {
    const before = entity({ category: "重要设定" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { category: "核心设定" },
      reason: "非标准分类「重要设定」→「核心设定」",
    }
    expect(classifyAutoExecution(operation, before)).toBe("category")
  })

  test("标准主分类带子分类形式也判为 category", () => {
    const before = entity({ category: "重要设定" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { category: "地点/城市" },
      reason: "归一并加子分类",
    }
    expect(isCategoryNormalizeUpdate(operation, before)).toBe(true)
  })
})

describe("白名单外：分类与结构操作", () => {
  test("标准分类之间的变更不判 category", () => {
    const before = entity({ category: "地理" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { category: "历史" },
      reason: "换分类",
    }
    expect(classifyAutoExecution(operation, before)).toBe(null)
  })

  test("非标准分类换成另一个非标准分类不判 category", () => {
    const before = entity({ category: "重要设定" })
    const operation: OrganizeOperation = {
      action: "update",
      entity_type: "world_entry",
      id: "w-1",
      fields: { category: "组织" },
      reason: "仍非标准",
    }
    expect(classifyAutoExecution(operation, before)).toBe(null)
  })

  test("合并与删除一律待审", () => {
    const before = entity({ content: "张三出身青云宗。" })
    const merge: OrganizeOperation = {
      action: "merge",
      entity_type: "world_entry",
      target_id: "w-1",
      source_ids: ["w-2"],
      fields: {},
      reason: "同标题重复",
    }
    const del: OrganizeOperation = { action: "delete", entity_type: "world_entry", id: "w-2", reason: "重复" }
    expect(classifyAutoExecution(merge, before)).toBe(null)
    expect(classifyAutoExecution(del, before)).toBe(null)
  })
})
