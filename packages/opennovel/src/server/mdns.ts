import { Bonjour } from "bonjour-service"

let bonjour: Bonjour | undefined
let currentPort: number | undefined

export function publish(port: number, domain?: string) {
  if (currentPort === port) return
  if (bonjour) unpublish()

  try {
    const host = domain ?? "opennovel.local"
    const name = `opennovel-${port}`
    bonjour = new Bonjour()
    const service = bonjour.publish({
      name,
      type: "http",
      host,
      port,
      txt: { path: "/" },
    })

    // 注册失败（端口冲突、组播不可用等）必须留痕，否则服务发现静默失效无从诊断
    service.on("error", (error: unknown) => {
      console.error(`mDNS service ${name} error`, error)
    })

    currentPort = port
  } catch (error) {
    console.error(`mDNS publish on port ${port} failed`, error)
    if (bonjour) {
      try {
        bonjour.destroy()
      } catch {}
    }
    bonjour = undefined
    currentPort = undefined
  }
}

export function unpublish() {
  if (bonjour) {
    try {
      bonjour.unpublishAll()
      bonjour.destroy()
    } catch {}
    bonjour = undefined
    currentPort = undefined
  }
}

export * as MDNS from "./mdns"
