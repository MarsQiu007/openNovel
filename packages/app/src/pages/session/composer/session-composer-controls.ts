import { base64Encode } from "@opennovel-ai/core/util/encode"
import { useNavigate } from "@solidjs/router"
import { type Accessor, createMemo } from "solid-js"
import type { PromptInputControls } from "@/components/prompt-input/contracts"
import type { PromptProjectControls } from "@/components/prompt-project-selector"
import { useDirectoryPicker } from "@/components/directory-picker"
import { useGlobal } from "@/context/global"
import { useLayout } from "@/context/layout"
import { useLocal } from "@/context/local"
import { useServerSDK } from "@/context/server-sdk"
import { serverName, ServerConnection, useServer } from "@/context/server"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useTabs } from "@/context/tabs"
import { useProviders } from "@/hooks/use-providers"
import { showAgentSelector } from "@/context/local-agent"

export function createPromptInputController(input: {
  sessionKey: Accessor<string>
  sessionID: Accessor<string | undefined>
}) {
  const layout = useLayout()
  const local = useLocal()
  const providers = useProviders()
  const sync = useSync()
  const view = layout.view(input.sessionKey)

  // 控件就绪锁存：controls_ready 表达"初始加载完成"，但连接/子 store 在桌面 sidecar
  // 场景会瞬时重建回落为 false，占位骨架与模型按钮随之反复互换（用户看到的"不停闪烁"）。
  // 就绪后控件数据更新走 store 订阅通道，与该门无关，因此一旦就绪即锁存不再回落。
  let controlsSettled = false
  const ready = () => {
    if (!controlsSettled && sync().data.controls_ready) controlsSettled = true
    return controlsSettled
  }

  // 数据非空锁存（keep-previous，与查询层 keepPreviousData 同构）：控件显隐与模型按钮
  // 文本派生自 agents/providers 数据而非 loading；桌面 sidecar 场景子 store/查询重建会让
  // 数据瞬时翻空（选择器显隐抖动、模型解析回落「选择模型」）。新值非空即更新，空翻窗
  // 保留上一份非空快照——真实增删照常透传，不被锁存掩盖。
  let agentsSeen: ReturnType<typeof local.agent.list> | undefined
  let modelSeen: ReturnType<typeof local.model.current> | undefined
  // 付费态锁存只锁「曾见过付费提供方」这一事实：数据翻空窗保留付费态防按钮抖动，
  // 但从未见过付费列表（如全免费/模拟环境）不臆造付费态，免费弹层路由不受影响
  let paidSeen = false
  // 会话切换（同页 params 变化）时复位锁存，避免上一会话的快照泄漏到新会话
  let latchedSession: string | undefined
  const stableAgentItems = () => {
    const next = local.agent.list()
    if (ready() && next.length > 0) agentsSeen = next
    return agentsSeen ?? next
  }
  const stableAgents = () => stableAgentItems().map((agent) => agent.name)
  const stableVisible = () => showAgentSelector(stableAgentItems())
  const stableCurrent = () => {
    const name = local.agent.current()?.name ?? ""
    if (!ready() || !name) return name
    const items = stableAgentItems()
    return items.some((item) => item.name === name) ? name : (items[0]?.name ?? name)
  }
  const stablePaid = () => {
    if (providers.paid().length > 0) paidSeen = true
    return paidSeen
  }
  const stableModelCurrent: PromptInputControls["model"]["selection"]["current"] = () => {
    const current = local.model.current()
    if (current) {
      if (ready()) modelSeen = current
      return current
    }
    return ready() ? modelSeen : undefined
  }

  return createMemo<PromptInputControls>(() => {
    const sessionID = input.sessionID()
    if (sessionID !== latchedSession) {
      latchedSession = sessionID
      controlsSettled = false
      agentsSeen = undefined
      modelSeen = undefined
      paidSeen = false
    }
    return {
      agents: {
        available: sync().data.agent,
        options: stableAgents(),
        current: stableCurrent(),
        loading: !ready(),
        visible: stableVisible(),
        select: local.agent.set,
      },
      model: {
        selection: {
          ...local.model,
          current: stableModelCurrent,
        } as PromptInputControls["model"]["selection"],
        paid: stablePaid(),
        loading: !ready(),
      },
      session: {
        id: sessionID,
        tabs: layout.tabs(input.sessionKey),
        reviewPanel: view.reviewPanel,
      },
    }
  })
}

export function createPromptProjectControls() {
  const navigate = useNavigate()
  const layout = useLayout()
  const server = useServer()
  const serverSDK = useServerSDK()
  const sdk = useSDK()
  const tabs = useTabs()
  const global = useGlobal()
  const pickDirectory = useDirectoryPicker()
  const projectServer = () => serverSDK().server
  const projectServerCtx = createMemo(() => global.ensureServerCtx(projectServer()))
  const projects = createMemo(() => {
    if (server.list.length <= 1) return layout.projects.list()
    return server.list.flatMap((conn) => {
      const item = { key: ServerConnection.key(conn), name: serverName(conn) }
      return global
        .ensureServerCtx(conn)
        .projects.list()
        .map((project) => ({ ...project, server: item }))
    })
  })
  const selectProject = (worktree: string, serverKey?: string) => {
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (!serverKey) {
      layout.projects.open(worktree)
      server.projects.touch(worktree)
      navigate(`/${base64Encode(worktree)}/session`)
      return
    }

    if (!conn) return
    const target = global.ensureServerCtx(conn)
    target.projects.open(worktree)
    target.projects.touch(worktree)
    server.setActive(ServerConnection.key(conn))
    navigate(`/${base64Encode(worktree)}/session`)
  }

  const addProject = (title: string, serverKey?: string) => {
    const conn = serverKey ? server.list.find((conn) => ServerConnection.key(conn) === serverKey) : projectServer()
    if (!conn) return
    pickDirectory({
      server: conn,
      title,
      onSelect: (result) => {
        const directory = Array.isArray(result) ? result[0] : result
        if (directory) selectProject(directory, serverKey)
      },
    })
  }

  return createMemo<PromptProjectControls>(() => ({
    available: projects(),
    directory: sdk().directory,
    server: server.list.length > 1 ? ServerConnection.key(projectServer()) : undefined,
    select: selectProject,
    add: addProject,
  }))
}
