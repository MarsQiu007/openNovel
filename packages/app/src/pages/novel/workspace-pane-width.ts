// 工作台分栏宽度派生：设定宽度是唯一状态，渲染宽度与自动收边阈值全部由此派生。
// 主区保底 160px 是唯一硬编码下限：保证窄态仍有可感知内容；侧栏不设静态上限，随窗口动态派生（VS Code 式拖拽模型）。
export const WORKSPACE_MAIN_MIN_WIDTH = 160

// 左栏（导航区）与右栏（随行区）的最小宽度和默认宽度；可调上限由 paneMaxWidth 按容器宽度派生
export const LEFT_PANE_MIN_WIDTH = 220
export const LEFT_PANE_DEFAULT_WIDTH = 288
export const RAIL_PANE_MIN_WIDTH = 320
export const RAIL_PANE_DEFAULT_WIDTH = 380

// 侧栏可调上限 = 三区容器宽度 − 主区保底 − 另一侧可见栏宽度（收起时传 0）。
// otherVisibleWidth 必须传另一侧未钳制的设定宽度：若传渲染宽度，左右会互相以对方钳制结果为输入形成循环派生。
export function paneMaxWidth(bodyWidth: number, otherVisibleWidth: number): number {
  return bodyWidth - WORKSPACE_MAIN_MIN_WIDTH - otherVisibleWidth
}

// persist 只存用户意图；null = 未拖过 = 默认宽度；非数值按默认处理（宽容读取，旧数据零迁移）
export function resolvePaneWidth(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" ? value : fallback
}

// 自动收边阈值：左档 = 左栏宽 + 主区保底；右档 = 左栏宽 + 右栏宽 + 主区保底。
// 右档包含展开中的右栏宽度；由于右栏最小宽度大于左栏最小宽度，右档始终晚于左档触发。
export function collapseThresholds(leftWidth: number, railWidth: number): { left: number; rail: number } {
  return {
    left: leftWidth + WORKSPACE_MAIN_MIN_WIDTH,
    rail: leftWidth + railWidth + WORKSPACE_MAIN_MIN_WIDTH,
  }
}
