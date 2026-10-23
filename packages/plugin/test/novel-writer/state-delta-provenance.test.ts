import { describe, test, expect } from "bun:test"
import { StateDeltaSchema, extractQuoteProvenance } from "../../src/novel-writer/state-commit.js"

// agent-memory-system Wave 2：StateDeltaEntry 出处字段（data.quote / data.quote_span）向后兼容。

describe("StateDelta 出处字段", () => {
  test("无出处的旧 delta 照常解码", () => {
    const result = StateDeltaSchema.safeParse([
      {
        fact_type: "timeline",
        action: "create",
        entity_id: "time_duanhunya",
        data: { event: "林天抵达断魂崖", timestamp: "三日后黄昏", relative_order: 3 },
      },
    ])
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(extractQuoteProvenance(result.data[0].data)).toEqual({})
  })

  test("带出处的新 delta 保留 quote / quote_span", () => {
    const result = StateDeltaSchema.safeParse([
      {
        fact_type: "timeline",
        action: "create",
        entity_id: "time_duanhunya",
        data: {
          event: "林天抵达断魂崖",
          timestamp: "三日后黄昏",
          relative_order: 3,
          quote: "黄昏时分，断魂崖出现在地平线上",
          quote_span: "p12",
        },
      },
    ])
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data[0].data.quote).toBe("黄昏时分，断魂崖出现在地平线上")
    expect(extractQuoteProvenance(result.data[0].data)).toEqual({
      quote: "黄昏时分，断魂崖出现在地平线上",
      quoteSpan: "p12",
    })
  })

  test("非字符串或空串出处字段被忽略", () => {
    expect(extractQuoteProvenance({ quote: 42, quote_span: null })).toEqual({})
    expect(extractQuoteProvenance({ quote: "", quote_span: "" })).toEqual({})
    expect(extractQuoteProvenance({ quote: "逐字引句" })).toEqual({ quote: "逐字引句" })
  })
})
