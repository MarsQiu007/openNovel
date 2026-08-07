import {
  createContext,
  createEffect,
  createRoot,
  createSignal,
  getOwner,
  onCleanup,
  type Owner,
  type ParentProps,
  runWithOwner,
  useContext,
  type JSX,
  startTransition,
  For,
} from "solid-js"
import { Dialog as Kobalte } from "@kobalte/core/dialog"
import { makeEventListener } from "@solid-primitives/event-listener"

type DialogElement = () => JSX.Element

type Active = {
  id: string
  node: JSX.Element
  dispose: () => void
  owner: Owner
  onClose?: () => void
  setClosing: (closing: boolean) => void
}

const Context = createContext<ReturnType<typeof init>>()

function init() {
  const [stack, setStack] = createSignal<Active[]>([])
  const timer = { current: undefined as ReturnType<typeof setTimeout> | undefined }
  const lock = { value: false }

  onCleanup(() => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
  })

  // 兜底校准 body pointer-events。
  // Kobalte 打开弹窗时会捕获当时的 body pointer-events 并在关闭时原样写回；
  // 若弹窗是在 corvu 抽屉（body 已被置为 none）之上打开的，写回的 "none"
  // 可能在抽屉关闭后残留，导致整个界面无法点击。这里在最后一个弹窗关闭、
  // 且 corvu 关闭过渡结束后检查一次：没有任何 modal 存活时恢复为可点击。
  const syncBodyPointerEvents = () => {
    if (stack().length > 0) return
    const body = document.body
    if (body.style.pointerEvents !== "none") return
    // corvu 抽屉/弹窗仍挂载（含关闭过渡中）时由其自行还原，不干预
    if (document.querySelector("[data-corvu-drawer-content], [data-corvu-dialog-content]")) return
    body.style.pointerEvents = ""
    if (body.style.length === 0) body.removeAttribute("style")
  }

  const close = (id?: string) => {
    const items = stack()
    const current = id ? items.find((item) => item.id === id) : items.at(-1)
    if (!current || lock.value) return
    lock.value = true
    current.onClose?.()
    current.setClosing(true)

    const closed = current.id
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }

    timer.current = setTimeout(() => {
      timer.current = undefined
      current.dispose()
      setStack((items) => items.filter((item) => item.id !== closed))
      lock.value = false
      // 等 corvu 关闭过渡（约 300ms）结束后再校准
      if (stack().length === 0) {
        setTimeout(syncBodyPointerEvents, 400)
      }
    }, 100)
  }

  createEffect(() => {
    if (stack().length === 0) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      close()
      event.preventDefault()
      event.stopPropagation()
    }

    makeEventListener(window, "keydown", onKeyDown, { capture: true })
  })

  const mount = (element: DialogElement, owner: Owner, onClose: (() => void) | undefined, layer: number) => {
    const id = Math.random().toString(36).slice(2)
    // 基准 z-index 必须高于抽屉（如角色编辑抽屉 z-[100]），否则确认弹窗会被抽屉遮罩盖住，
    // 点击落在抽屉 overlay 上会导致 Kobalte 弹窗与 corvu 抽屉互相触发关闭，
    // 两套 modal 系统先后还原 body pointer-events 时残留 none，造成整个界面无法点击
    const zIndex = 200 + layer * 10
    let dispose: (() => void) | undefined
    let setClosing: ((closing: boolean) => void) | undefined

    const node = runWithOwner(owner, () =>
      createRoot((d: () => void) => {
        dispose = d
        const [closing, setClosingSignal] = createSignal(false)
        setClosing = setClosingSignal
        return (
          <Kobalte
            modal
            open={!closing()}
            onOpenChange={(open: boolean) => {
              if (open) return
              close(id)
            }}
          >
            <Kobalte.Portal>
              <Kobalte.Overlay
                data-component="dialog-overlay"
                style={{ "z-index": String(zIndex) }}
                onClick={() => close(id)}
              />
              <div
                data-dialog-layer={layer}
                style={{
                  position: "fixed",
                  inset: "0",
                  "z-index": String(zIndex),
                  display: "flex",
                  "align-items": "center",
                  "justify-content": "center",
                  "pointer-events": "none",
                }}
              >
                {element()}
              </div>
            </Kobalte.Portal>
          </Kobalte>
        )
      }),
    )

    if (!dispose || !setClosing) return

    const active: Active = { id, node, dispose, owner, onClose, setClosing }
    setStack((items) => [...items, active])
  }

  const push = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    lock.value = false
    mount(element, owner, onClose, stack().length)
  }

  const show = (element: DialogElement, owner: Owner, onClose?: () => void) => {
    for (const item of stack()) item.dispose()
    setStack([])
    if (timer.current !== undefined) {
      clearTimeout(timer.current)
      timer.current = undefined
    }
    lock.value = false
    mount(element, owner, onClose, 0)
  }

  return {
    stack,
    close,
    show,
    push,
  }
}

export function DialogProvider(props: ParentProps) {
  const ctx = init()
  return (
    <Context.Provider value={ctx}>
      {props.children}
      <div data-component="dialog-stack">
        <For each={ctx.stack()}>{(item) => item.node}</For>
      </div>
    </Context.Provider>
  )
}

export function useDialog() {
  const ctx = useContext(Context)
  const owner = getOwner()

  if (!owner) {
    throw new Error("useDialog must be used within a DialogProvider")
  }
  if (!ctx) {
    throw new Error("useDialog must be used within a DialogProvider")
  }

  return {
    get active() {
      return ctx.stack().at(-1)
    },
    show(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.show(element, base, onClose))
    },
    push(element: DialogElement, onClose?: () => void) {
      const base = ctx.stack().at(-1)?.owner ?? owner
      return startTransition(() => ctx.push(element, base, onClose))
    },
    close() {
      ctx.close()
    },
  }
}
