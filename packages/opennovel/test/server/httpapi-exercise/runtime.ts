export type Runtime = {
  PublicApi: (typeof import("../../../src/server/routes/instance/httpapi/public"))["PublicApi"]
  HttpApiApp: (typeof import("../../../src/server/routes/instance/httpapi/server"))["HttpApiApp"]
  AppLayer: (typeof import("../../../src/effect/app-runtime"))["AppLayer"]
  InstanceRef: (typeof import("../../../src/effect/instance-ref"))["InstanceRef"]
  InstanceStore: (typeof import("../../../src/project/instance-store"))["InstanceStore"]
  Worktree: (typeof import("../../../src/worktree"))["Worktree"]
  tmpdir: (typeof import("../../fixture/fixture"))["tmpdir"]
}

let runtimePromise: Promise<Runtime> | undefined

export function runtime() {
  return (runtimePromise ??= (async () => {
    const publicApi = await import("../../../src/server/routes/instance/httpapi/public")
    const httpApiServer = await import("../../../src/server/routes/instance/httpapi/server")
    const appRuntime = await import("../../../src/effect/app-runtime")
    const instanceRef = await import("../../../src/effect/instance-ref")
    const instanceStore = await import("../../../src/project/instance-store")
    const worktree = await import("../../../src/worktree")
    const fixture = await import("../../fixture/fixture")
    return {
      PublicApi: publicApi.PublicApi,
      HttpApiApp: httpApiServer.HttpApiApp,
      AppLayer: appRuntime.AppLayer,
      InstanceRef: instanceRef.InstanceRef,
      InstanceStore: instanceStore.InstanceStore,
      Worktree: worktree.Worktree,
      tmpdir: fixture.tmpdir,
    }
  })())
}
