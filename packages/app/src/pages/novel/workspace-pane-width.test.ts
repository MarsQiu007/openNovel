import { describe, expect, test } from "bun:test"
import {
  collapseThresholds,
  LEFT_PANE_DEFAULT_WIDTH,
  LEFT_PANE_MAX_WIDTH,
  LEFT_PANE_MIN_WIDTH,
  RAIL_PANE_DEFAULT_WIDTH,
  RAIL_PANE_MAX_WIDTH,
  RAIL_PANE_MIN_WIDTH,
  resolvePaneWidth,
  WORKSPACE_DOCK_WIDTH,
  WORKSPACE_DOCK_TOTAL_WIDTH,
  WORKSPACE_MAIN_MIN_WIDTH,
} from "./workspace-pane-width"

describe("collapseThresholds", () => {
  test("reserves dock width before auto collapsing either pane", () => {
    const thresholds = collapseThresholds(LEFT_PANE_DEFAULT_WIDTH, RAIL_PANE_DEFAULT_WIDTH)
    expect(thresholds.left).toBe(LEFT_PANE_DEFAULT_WIDTH + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBe(
      LEFT_PANE_DEFAULT_WIDTH + RAIL_PANE_DEFAULT_WIDTH + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH,
    )
    expect(thresholds.rail).toBeGreaterThan(thresholds.left)
  })

  test("keeps the rail threshold strictly above the left threshold when the rail is dragged narrower", () => {
    // 角色语义：随行右栏先让位——即使右栏 320 < 左栏 350，右档也必须更大
    const thresholds = collapseThresholds(350, RAIL_PANE_MIN_WIDTH)
    expect(thresholds.left).toBe(350 + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBe(350 + RAIL_PANE_MIN_WIDTH + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBeGreaterThan(thresholds.left)
  })

  test("derives the rail threshold from the rail width when it is the wider pane", () => {
    const thresholds = collapseThresholds(LEFT_PANE_MIN_WIDTH, RAIL_PANE_MAX_WIDTH)
    expect(thresholds.left).toBe(LEFT_PANE_MIN_WIDTH + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBe(
      LEFT_PANE_MIN_WIDTH + RAIL_PANE_MAX_WIDTH + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH,
    )
  })

  test("keeps the promised 36px dock width", () => {
    expect(WORKSPACE_DOCK_WIDTH).toBe(36)
    expect(WORKSPACE_DOCK_TOTAL_WIDTH).toBe(72)
  })
})

describe("resolvePaneWidth", () => {
  test("keeps a persisted width as-is", () => {
    expect(resolvePaneWidth(460, RAIL_PANE_DEFAULT_WIDTH)).toBe(460)
  })

  test("falls back to the default for null, undefined and non-numeric legacy data", () => {
    expect(resolvePaneWidth(null, LEFT_PANE_DEFAULT_WIDTH)).toBe(LEFT_PANE_DEFAULT_WIDTH)
    expect(resolvePaneWidth(undefined, LEFT_PANE_DEFAULT_WIDTH)).toBe(LEFT_PANE_DEFAULT_WIDTH)
    // JSON.parse 返回 any：模拟手改 localStorage 留下的字符串宽度（未识别的历史字段）
    expect(resolvePaneWidth(JSON.parse('"400"'), LEFT_PANE_DEFAULT_WIDTH)).toBe(LEFT_PANE_DEFAULT_WIDTH)
  })

  test("exposes the pane bounds the spec promises", () => {
    expect(LEFT_PANE_MIN_WIDTH).toBe(220)
    expect(LEFT_PANE_MAX_WIDTH).toBe(400)
    expect(RAIL_PANE_MIN_WIDTH).toBe(320)
    expect(RAIL_PANE_MAX_WIDTH).toBe(560)
  })
})
