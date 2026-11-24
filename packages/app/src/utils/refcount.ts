import { getOwner, onCleanup, runWithOwner } from "solid-js"

/** 非响应式 acquire 的返回对象在原资源上派生，附带一次性 dispose，避免覆盖共享资源的句柄。 */
export type RefCounted<T extends object> = T & { dispose?: () => void }

export function createRefCountMap<T extends object>(
  create: (key: string) => T,
  remove?: (key: string) => void,
  identity: (key: string) => string = (key) => key,
) {
  const items = new Map<string, T>()
  const refCounts = new Map<string, number>()

  const release = (id: string) => {
    refCounts.set(id, (refCounts.get(id) ?? 0) - 1)
    if (refCounts.get(id) === 0) {
      remove?.(id)
      items.delete(id)
      refCounts.delete(id)
    }
  }

  return (key: string): RefCounted<T> => {
    const id = identity(key)
    const owner = getOwner()
    if (owner) {
      // 响应式所有权：cleanup 挂到 acquire 当时的 owner，重建/销毁时自动释放。
      runWithOwner(owner, () => onCleanup(() => release(id)))
    }

    const cached = items.get(id)
    if (cached) {
      refCounts.set(id, (refCounts.get(id) ?? 0) + 1)
      return owner ? cached : detachedHandle(cached, () => release(id))
    }

    const item = create(key)
    items.set(id, item)
    refCounts.set(id, 1)
    return owner ? item : detachedHandle(item, () => release(id))
  }
}

// 非响应式 acquire 不能挂 cleanup；用原型派生保持 getter/方法，同时让每个调用者拿到独立 dispose。
function detachedHandle<T extends object>(item: T, release: () => void): RefCounted<T> {
  let disposed = false
  const detached: RefCounted<T> = Object.create(item)
  detached.dispose = () => {
    if (disposed) return
    disposed = true
    release()
  }
  return detached
}
