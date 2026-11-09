/** Minimal read view of a session, for parent-chain walks inside plugins. */
export interface SessionRef {
  readonly id: string
  readonly parentID?: string
  /**
   * 只读内部会话标记：宿主在 create 前登记进程级 purpose，get 时从注册表回填。
   * 事件处理器在计数前必须先排除带 purpose 的会话。
   */
  readonly purpose?: "tool-insight"
}

/** 宿主签发的复测执行授权：与正文内容 grant 是不同能力，后台 retest 必须携带 */
export interface BackgroundSessionAuthorization {
  readonly id: string
  /** 绑定规范化案例摘要：案例变化后原授权无效 */
  readonly caseDigest: string
}

/**
 * 目的受限后台会话输入。位置来源二选一：在线归因传 parentID（继承原 Location），
 * 复测传显式临时 directory（无父级顶层会话）。organize 的预期工具集合必须为空，
 * retest 必须携带宿主执行授权；两者都在 create 前由宿主强制校验。
 */
export interface BackgroundSessionInput {
  readonly mode: "organize" | "retest"
  readonly agent: string
  readonly model?: { readonly providerID: string; readonly modelID: string }
  readonly prompt: string
  readonly expectedTools: readonly string[]
  readonly parentID?: string
  readonly directory?: string
  readonly authorization?: BackgroundSessionAuthorization
}

export type BackgroundSessionResult =
  | { readonly status: "success"; readonly text: string }
  | { readonly status: "failure"; readonly reason: string }
  | { readonly status: "cancelled" }

export interface BackgroundSessionHandle {
  readonly id: string
  /** 等待后台会话到达 settled 观察点后的最终结果；真实执行错误不会被吞掉 */
  readonly done: Promise<BackgroundSessionResult>
  /** 三阶段取消：等待创建时不再 create、已 admission 未 resume 时不再发车、执行中真实 interrupt */
  readonly cancel: () => Promise<void>
}

export interface SessionDomain {
  readonly get: (id: string) => Promise<SessionRef | undefined>
  /**
   * 等待该 Session 当前活动 drain 落定，并确认观察点不再活动；若因 pending wake
   * 再次活动则继续等待下一边界。只等待，不注入 prompt、不中断执行。
   */
  readonly settled: (id: string) => Promise<void>
  /** 目的受限后台会话：预分配 ID 并登记 purpose，admission 后由宿主 resume 驱动 */
  readonly startBackground: (input: BackgroundSessionInput) => Promise<BackgroundSessionHandle>
}
