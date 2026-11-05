import { describe, expect, test } from "bun:test"
import {
  createUpdaterController,
  shouldPromptInstallOnQuit,
  type UpdaterBackend,
  type UpdaterReadyRecord,
} from "./updater-controller"

function setup(input?: { currentVersion?: string; ready?: UpdaterReadyRecord }) {
  const calls: string[] = []
  const backend: UpdaterBackend = {
    async checkForUpdates() {
      calls.push("check")
      return { isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }
    },
    async downloadUpdate() {
      calls.push("download")
    },
    quitAndInstall() {
      calls.push("install")
    },
  }
  let ready = input?.ready
  const controller = createUpdaterController({
    enabled: true,
    currentVersion: input?.currentVersion ?? "1.0.0",
    backend,
    persistence: {
      get: () => ready,
      set: (value) => {
        ready = value
      },
      clear: () => {
        ready = undefined
      },
    },
    stop: async () => {
      calls.push("stop")
    },
  })
  return { controller, calls, getReady: () => ready }
}

describe("updater controller", () => {
  test("checks, downloads, persists, and publishes one authoritative ready state", async () => {
    const app = setup()
    const states: ReturnType<typeof app.controller.getState>[] = []
    app.controller.subscribe((state) => states.push(state))

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.getReady()).toEqual({ version: "2.0.0" })
    expect(states.map((state) => state.status)).toEqual(["idle", "checking", "downloading", "ready"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("revalidates a persisted target through the updater cache on launch", async () => {
    const app = setup({ ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.calls).toEqual(["check", "download"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("clears a target already installed before checking", async () => {
    const app = setup({ currentVersion: "2.0.0", ready: { version: "2.0.0" } })

    await app.controller.start()

    expect(app.getReady()).toBeUndefined()
    expect(app.calls).toEqual(["check"])
  })

  test("coalesces concurrent checks", async () => {
    const app = setup()

    await Promise.all([app.controller.check(), app.controller.check(), app.controller.check()])

    expect(app.calls).toEqual(["check", "download"])
  })

  test("returns to ready when quitAndInstall returns without exiting", async () => {
    const app = setup()
    await app.controller.start()

    await app.controller.install()

    expect(app.calls).toEqual(["check", "download", "stop", "install"])
    expect(app.controller.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })

  test("returns to ready when installation cannot start", async () => {
    const app = setup()
    await app.controller.start()

    const failed = createUpdaterController({
      enabled: true,
      currentVersion: "1.0.0",
      backend: {
        checkForUpdates: async () => ({ isUpdateAvailable: true, updateInfo: { version: "2.0.0" } }),
        downloadUpdate: async () => {},
        quitAndInstall() {},
      },
      persistence: { get: () => undefined, set() {}, clear() {} },
      stop: async () => {
        throw new Error("stop failed")
      },
    })
    await failed.start()

    await expect(failed.install()).rejects.toThrow("stop failed")
    expect(failed.getState()).toEqual({ status: "ready", version: "2.0.0" })
  })
})

describe("shouldPromptInstallOnQuit", () => {
  const ready = { status: "ready", version: "2.0.0" } as const

  test("更新就绪且为用户退出时拦截", () => {
    expect(shouldPromptInstallOnQuit(ready, false)).toBe(true)
  })

  test("updater 发起的退出不拦截", () => {
    expect(shouldPromptInstallOnQuit(ready, true)).toBe(false)
  })

  test("非就绪状态不拦截", () => {
    expect(shouldPromptInstallOnQuit({ status: "idle" }, false)).toBe(false)
    expect(shouldPromptInstallOnQuit({ status: "downloading", version: "2.0.0" }, false)).toBe(false)
    expect(shouldPromptInstallOnQuit({ status: "up-to-date" }, false)).toBe(false)
  })

  test("更新禁用时不拦截", () => {
    expect(shouldPromptInstallOnQuit({ status: "disabled" }, false)).toBe(false)
  })
})

describe("resumedPendingUpdate", () => {
  test("存在版本不匹配的未决记录时视为启动恢复", async () => {
    const app = setup({ ready: { version: "2.0.0" } })
    expect(await app.controller.resumedPendingUpdate()).toBe(true)
  })

  test("无持久化记录时不视为启动恢复", async () => {
    const app = setup()
    expect(await app.controller.resumedPendingUpdate()).toBe(false)
  })

  test("记录版本与当前版本一致（安装已完成）时不视为启动恢复", async () => {
    const app = setup({ currentVersion: "2.0.0", ready: { version: "2.0.0" } })
    expect(await app.controller.resumedPendingUpdate()).toBe(false)
  })
})
