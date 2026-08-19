import { randomUUID } from "crypto"
import { readFile, writeFile, mkdir } from "fs/promises"
import os from "os"
import path from "path"

export interface DeviceIdentity {
  id: string
  name: string
}

/**
 * 读取（或首次生成）本设备的同步身份。
 * 存于全局 state 目录，与项目无关；同一用户的不同设备各有稳定 ID，
 * 用于快照清单中的来源标识与冲突提示。
 */
export async function getDeviceIdentity(stateDir: string): Promise<DeviceIdentity> {
  const file = path.join(stateDir, "sync-device.json")
  const text = await readFile(file, "utf8").catch(() => undefined)
  if (text !== undefined) {
    const parsed = JSON.parse(text) as Partial<DeviceIdentity>
    if (typeof parsed.id === "string" && typeof parsed.name === "string") {
      return { id: parsed.id, name: parsed.name }
    }
  }
  const identity: DeviceIdentity = { id: randomUUID(), name: os.hostname() || "unknown-device" }
  await mkdir(stateDir, { recursive: true })
  await writeFile(file, JSON.stringify(identity, null, 2))
  return identity
}
