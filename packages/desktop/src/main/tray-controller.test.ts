import { describe, expect, test } from "bun:test"
import { createTrayController, resolveCloseToTrayDefault } from "./tray-controller"

function setup(initial: { enabled?: boolean; quitting?: boolean } = {}) {
  const state = { enabled: initial.enabled ?? true, quitting: initial.quitting ?? false }
  const controller = createTrayController<{ name: string }>({
    closeToTrayEnabled: () => state.enabled,
    isQuitting: () => state.quitting,
    translate: (key) => `tr:${key}`,
  })
  return { controller, state }
}

describe("shouldHideOnClose", () => {
  test("开关开启且非真退出时拦截关闭", () => {
    expect(setup().controller.shouldHideOnClose()).toBe(true)
  })

  test("开关关闭时放行", () => {
    expect(setup({ enabled: false }).controller.shouldHideOnClose()).toBe(false)
  })

  test("真退出流程中放行（即使开关开启）", () => {
    const app = setup({ quitting: true })
    expect(app.controller.shouldHideOnClose()).toBe(false)
    app.state.quitting = false
    expect(app.controller.shouldHideOnClose()).toBe(true)
  })
})

describe("hide / restoreAll", () => {
  test("重复隐藏同一窗口幂等", () => {
    const app = setup()
    const win = { name: "a" }
    app.controller.hide(win)
    app.controller.hide(win)
    expect(app.controller.restoreAll()).toEqual([win])
  })

  test("restoreAll 按隐藏顺序返回并清空集合", () => {
    const app = setup()
    const a = { name: "a" }
    const b = { name: "b" }
    app.controller.hide(a)
    app.controller.hide(b)
    expect(app.controller.restoreAll()).toEqual([a, b])
    expect(app.controller.restoreAll()).toEqual([])
  })
})

describe("menu", () => {
  test("菜单恰好三项且经注入取词函数渲染", () => {
    const app = setup()
    expect(app.controller.menu()).toEqual([
      { id: "show", label: "tr:tray.show" },
      { id: "settings", label: "tr:tray.settings" },
      { id: "quit", label: "tr:tray.quit" },
    ])
  })
})

describe("resolveCloseToTrayDefault", () => {
  test("Windows 默认开启，其他平台默认关闭", () => {
    expect(resolveCloseToTrayDefault("win32")).toBe(true)
    expect(resolveCloseToTrayDefault("linux")).toBe(false)
    expect(resolveCloseToTrayDefault("darwin")).toBe(false)
  })
})
