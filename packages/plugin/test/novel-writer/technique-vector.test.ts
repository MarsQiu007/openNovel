import { describe, test, expect } from "bun:test"
import { cosineSimilarity, rankBySimilarity } from "../../src/novel-writer/technique-vector.js"

describe("cosineSimilarity", () => {
  test("identical vectors return 1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1)
  })

  test("orthogonal vectors return 0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })

  test("empty vectors return 0", () => {
    expect(cosineSimilarity([], [])).toBe(0)
  })
})

describe("rankBySimilarity", () => {
  test("sorts descending by similarity", () => {
    const items = [
      { id: "a", embedding: [1, 0] },
      { id: "b", embedding: [0, 1] },
      { id: "c", embedding: [0.7, 0.7] },
    ]
    const ranked = rankBySimilarity(items, [1, 0])
    expect(ranked[0].id).toBe("a")
    expect(ranked[1].id).toBe("c")
    expect(ranked[2].id).toBe("b")
  })
})
