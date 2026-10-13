import { randomUUID } from "crypto"
import { readFile, writeFile, mkdir } from "fs/promises"
import os from "os"
import path from "path"
import { Json } from "../util/json"

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
    // 身份文件损坏按「未初始化」处理：这条路径必须能自愈重建，而不是让 SyntaxError 打断同步启动
    const parsed = Json.parseObject(text) as Partial<DeviceIdentity> | undefined
    if (parsed && typeof parsed.id === "string" && typeof parsed.name === "string") {
      return { id: parsed.id, name: parsed.name }
    }
  }
  const identity: DeviceIdentity = { id: randomUUID(), name: os.hostname() || "unknown-device" }
  await mkdir(stateDir, { recursive: true })
  await writeFile(file, JSON.stringify(identity, null, 2))
  return identity
}
