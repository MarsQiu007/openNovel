// 工作台分栏宽度派生（设计 D1/D2/D5）：设定宽度是唯一状态，渲染宽度与自动收边阈值全部由此派生。
// 主区保底 720px 为唯一硬编码常量；默认宽度下阈值与归档实现（左档 1008 / 右档 1100）逐比特一致。

export const WORKSPACE_MAIN_MIN_WIDTH = 720

// 左栏（导航区）与右栏（随行区）的可调边界与默认宽度（D3：静态边界，不随窗口动态化）
export const LEFT_PANE_MIN_WIDTH = 220
export const LEFT_PANE_MAX_WIDTH = 400
export const LEFT_PANE_DEFAULT_WIDTH = 288
export const RAIL_PANE_MIN_WIDTH = 320
export const RAIL_PANE_MAX_WIDTH = 560
export const RAIL_PANE_DEFAULT_WIDTH = 380

// 收起态不再完全隐藏，而是保留一个可点击的薄边坞；阈值按两侧坞的总保留宽度预留
export const WORKSPACE_DOCK_WIDTH = 36
export const WORKSPACE_DOCK_TOTAL_WIDTH = WORKSPACE_DOCK_WIDTH * 2

// persist 只存用户意图：null = 未拖过 = 默认宽度；非数值按默认处理（宽容读取，旧数据零迁移）
export function resolvePaneWidth(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback
}

// 自动收边阈值派生（D2）：左档 = 左栏宽 + 主区保底；右档 = max(右栏宽 + 主区保底, 左档 + 1)。
// 右档包含展开中的右栏宽度；由于右栏最小宽度大于单坞保留宽度，右档始终晚于左档触发，
// 维持“随行右栏先让位”的角色语义。
export function collapseThresholds(leftWidth: number, railWidth: number): { left: number; rail: number } {
  return {
    left: leftWidth + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH,
    rail: leftWidth + railWidth + WORKSPACE_DOCK_TOTAL_WIDTH + WORKSPACE_MAIN_MIN_WIDTH,
  }
}
