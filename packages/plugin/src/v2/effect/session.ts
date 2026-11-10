/** Minimal read view of a session, for parent-chain walks inside plugins. */
export interface SessionRef {
  readonly id: string
  readonly parentID?: string
  /**
   * 规范 stored.location（持久化 Session 行上的目录）：复测隔离核验用它定位原书
   * 做前后摘要比对，不取工具执行时的运行时 cwd。
   */
  readonly location?: string
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
 * 复测专用 agent 规格（任务 5.4）：插件 ctx 无法跨 Location transform，由宿主在
 * 临时 Location 作用域代持注册并在作用域 finalizer 清理。deny-first 权限规则
 * （先全量 deny 再逐项 allow 案例白名单）由宿主按 expectedTools 构造，不由插件传入。
 */
export interface BackgroundRetestAgent {
  readonly id: string
  readonly description: string
  readonly system: string
}

/**
 * 目的受限后台会话输入。位置来源二选一：在线归因传 parentID（继承原 Location），
 * 复测传显式临时 directory（无父级顶层会话）。organize 的预期工具集合必须为空，
 * retest 必须携带宿主执行授权与发起确认的原会话；两者都在 create 前由宿主强制
 * 校验并按授权次数消费。
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
  /** retest 发起确认所在的原会话：宿主与授权签发记录核对，不符即拒绝 */
  readonly originSessionID?: string
  /** retest 专用 agent 规格：宿主在临时 Location 代持注册 deny-first 复测 agent */
  readonly retestAgent?: BackgroundRetestAgent
  /**
   * retest 前置插件（如 config-plugin 与 novel-writer）：临时 Location 层构建不等待
   * 插件引导（内部引导 fork），宿主逐个有界等待激活后才注册 agent 与预检；插件
   * 装载失败或有界期限超时均失败关闭，不使用固定 sleep。
   */
  readonly requiredPlugins?: readonly string[]
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
