/**
 * 同步远端适配器接口。
 *
 * 所有 remotePath 均为 posix 风格、以远端根目录为基准的相对路径（不含前导 "/"）。
 * 实现方自行拼接根目录。
 */
export interface RemoteStat {
  size: number
  /** epoch millis */
  mtime: number
}

export interface SyncAdapter {
  /** 远端文件信息；不存在时返回 undefined */
  stat(remotePath: string): Promise<RemoteStat | undefined>
  /** 递归创建目录（已存在时视为成功） */
  mkdir(remotePath: string): Promise<void>
  /** 上传本地文件覆盖远端目标 */
  upload(localFile: string, remotePath: string): Promise<void>
  /** 下载远端文件到本地路径 */
  download(remotePath: string, localFile: string): Promise<void>
  /** 远端内移动/重命名（用于 tmp → 正式名的原子发布） */
  move(from: string, to: string): Promise<void>
  /** 递归删除远端文件或目录；不存在时视为成功 */
  remove(remotePath: string): Promise<void>
  /** 列出目录下的直接子项名称；目录不存在时返回空数组 */
  list(remotePath: string): Promise<string[]>
  /** 读取 JSON；不存在时返回 undefined */
  readJson(remotePath: string): Promise<unknown>
  /** 写入 JSON */
  writeJson(remotePath: string, value: unknown): Promise<void>
}
