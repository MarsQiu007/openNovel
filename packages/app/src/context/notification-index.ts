import { pathKey } from "@/utils/path-key"
import type { SessionErrorUnknown } from "@opennovel-ai/sdk/v2"

export type NotificationBase = {
  directory?: string
  session?: string
  metadata?: unknown
  time: number
  viewed: boolean
}

export type TurnCompleteNotification = NotificationBase & {
  type: "turn-complete"
}

export type ErrorNotification = NotificationBase & {
  type: "error"
  error?: SessionErrorUnknown
}

export type Notification = TurnCompleteNotification | ErrorNotification

export type NotificationIndex = {
  session: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
  project: {
    all: Record<string, Notification[]>
    unseen: Record<string, Notification[]>
    unseenCount: Record<string, number>
    unseenHasError: Record<string, boolean>
  }
}

function createNotificationIndex(): NotificationIndex {
  return {
    session: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
    project: {
      all: {},
      unseen: {},
      unseenCount: {},
      unseenHasError: {},
    },
  }
}

// project 索引键统一为 pathKey 形态：持久化历史条目与事件目录可能带混合分隔符形态
export function buildNotificationIndex(list: Notification[]) {
  const index = createNotificationIndex()

  list.forEach((notification) => {
    if (notification.session) {
      const all = index.session.all[notification.session] ?? []
      index.session.all[notification.session] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.session.unseen[notification.session] ?? []
        index.session.unseen[notification.session] = [...unseen, notification]
        index.session.unseenCount[notification.session] = unseen.length + 1
        if (notification.type === "error") index.session.unseenHasError[notification.session] = true
      }
    }

    if (notification.directory) {
      const key = pathKey(notification.directory)
      const all = index.project.all[key] ?? []
      index.project.all[key] = [...all, notification]
      if (!notification.viewed) {
        const unseen = index.project.unseen[key] ?? []
        index.project.unseen[key] = [...unseen, notification]
        index.project.unseenCount[key] = unseen.length + 1
        if (notification.type === "error") index.project.unseenHasError[key] = true
      }
    }
  })

  return index
}
