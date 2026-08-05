interface ImportMetaEnv {
  readonly OPENNOVEL_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:opennovel-server" {
  export namespace Server {
    export const listen: typeof import("../../../opennovel/dist/types/src/node").Server.listen
    export type Listener = import("../../../opennovel/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../opennovel/dist/types/src/node").Config.get
    export type Info = import("../../../opennovel/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../opennovel/dist/types/src/node").bootstrap
}
