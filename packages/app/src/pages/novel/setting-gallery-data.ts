/**
 * 设定图片画廊的纯助手（setting-entry-gallery design D8）。
 *
 * 与组件解耦以便单测：文件校验、排序调整、头像选取不含副作用。
 */

export const GALLERY_MAX_BYTES = 5 * 1024 * 1024
export const GALLERY_MIME_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const

export type GalleryFileError = "tooLarge" | "badType"

/** 上传前的文件校验：浏览器侧 file.size 即解码后字节数，与存储层上限同值。 */
export function validateImageFile(file: Pick<File, "size" | "type">): GalleryFileError | null {
  if (file.size > GALLERY_MAX_BYTES) return "tooLarge"
  if (!(GALLERY_MIME_TYPES as readonly string[]).includes(file.type)) return "badType"
  return null
}

/** 上移/下移：把 id 在列表内移动 delta 位，越界时保持原列表。 */
export function moveItem(ids: readonly string[], id: string, delta: -1 | 1): readonly string[] {
  const index = ids.indexOf(id)
  const target = index + delta
  if (index < 0 || target < 0 || target >= ids.length) return ids
  const next = [...ids]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  return next
}

/** 头像 = 排序最前的图片；空列表返回 null（调用方回退占位）。 */
export function avatarOf(images: ReadonlyArray<{ id: string; sortOrder: number; createdAt: number }>): string | null {
  const first = images.toSorted((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)[0]
  return first?.id ?? null
}
