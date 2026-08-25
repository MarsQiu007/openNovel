/// <reference types="@solidjs/start/env" />

// solid-js/web 的 client 类型定义中 RequestEvent 缺少 locals,
// 但服务端运行时(RequestContext)会注入 locals。在此补齐以通过类型检查。
// 各字段(如 actor)由使用处就近声明具体类型。
declare module "solid-js/web" {
  interface RequestEventLocals {
    [key: string | number | symbol]: unknown
  }
  interface RequestEvent {
    locals: RequestEventLocals
  }
}

export declare module "@solidjs/start/server" {
  export type APIEvent = { request: Request }
}
