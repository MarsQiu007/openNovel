import { describe, expect, test } from "bun:test"
import {
  collapseThresholds,
  LEFT_PANE_DEFAULT_WIDTH,
  LEFT_PANE_MIN_WIDTH,
  paneMaxWidth,
  RAIL_PANE_DEFAULT_WIDTH,
  RAIL_PANE_MIN_WIDTH,
  resolvePaneWidth,
  WORKSPACE_MAIN_MIN_WIDTH,
} from "./workspace-pane-width"

describe("collapseThresholds", () => {
  test("reserves only pane content before auto collapsing either pane", () => {
    const thresholds = collapseThresholds(LEFT_PANE_DEFAULT_WIDTH, RAIL_PANE_DEFAULT_WIDTH)
    expect(thresholds.left).toBe(LEFT_PANE_DEFAULT_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBe(LEFT_PANE_DEFAULT_WIDTH + RAIL_PANE_DEFAULT_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBeGreaterThan(thresholds.left)
  })

  test("keeps the rail threshold strictly above the left threshold when the rail is dragged narrower", () => {
    // 角色语义：随行右栏先让位——即使右栏 320 < 左栏 350，右档也必须更大
    const thresholds = collapseThresholds(350, RAIL_PANE_MIN_WIDTH)
    expect(thresholds.left).toBe(350 + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBe(350 + RAIL_PANE_MIN_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBeGreaterThan(thresholds.left)
  })

  test("derives the rail threshold from the rail width when it is the wider pane", () => {
    const thresholds = collapseThresholds(LEFT_PANE_MIN_WIDTH, 560)
    expect(thresholds.left).toBe(LEFT_PANE_MIN_WIDTH + WORKSPACE_MAIN_MIN_WIDTH)
    expect(thresholds.rail).toBe(LEFT_PANE_MIN_WIDTH + 560 + WORKSPACE_MAIN_MIN_WIDTH)
  })
})

describe("paneMaxWidth", () => {
  test("reserves the main floor and the other visible pane from the body width", () => {
    expect(paneMaxWidth(1000, 380)).toBe(590)
  })

  test("treats a collapsed other pane as zero", () => {
    expect(paneMaxWidth(1000, 0)).toBe(970)
  })

  test("lets a pane squeeze the main area down to the floor on wide bodies", () => {
    expect(paneMaxWidth(2000, LEFT_PANE_MIN_WIDTH)).toBe(2000 - WORKSPACE_MAIN_MIN_WIDTH - LEFT_PANE_MIN_WIDTH)
  })

  test("may dip below the pane minimum on narrow bodies; rendering floors at the minimum", () => {
    expect(paneMaxWidth(500, RAIL_PANE_MIN_WIDTH)).toBe(150)
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
})

test("exposes the pane bounds the spec promises", () => {
  expect(WORKSPACE_MAIN_MIN_WIDTH).toBe(30)
  expect(LEFT_PANE_MIN_WIDTH).toBe(220)
  expect(RAIL_PANE_MIN_WIDTH).toBe(320)
  expect(LEFT_PANE_DEFAULT_WIDTH).toBe(288)
  expect(RAIL_PANE_DEFAULT_WIDTH).toBe(380)
})
