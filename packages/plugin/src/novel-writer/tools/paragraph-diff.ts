/**
 * 段落级 diff。用最长公共子序列（LCS）对齐两段按行/段切分的内容，
 * 输出 same / add / remove 三种操作的数组，供 diff_chapter_version 工具使用。
 *
 * - 同一段：标记 same（输出空格前缀）
 * - 仅旧版本有：标记 remove（- 前缀）
 * - 仅新版本有：标记 add（+ 前缀）
 *
 * 简化版：跳过 block move（顺序敏感），LCS 对齐保证相同段落不被误标 add/remove。
 * 对章节正文来说，正文很少整体 block move，常见模式是「保留大部分 + 改几段」，
 * 这种模式下 LCS 准确率足够。
 */
export type DiffOp = { kind: "same" | "add" | "remove"; text: string }

export function computeParagraphDiff(a: string[], b: string[]): DiffOp[] {
  const m = a.length
  const n = b.length
  // 1) dp[i][j] = LCS length of a[0..i-1], b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }
  // 2) 反向回溯生成 diff
  const out: DiffOp[] = []
  let i = m
  let j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      out.push({ kind: "same", text: a[i - 1] })
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      out.push({ kind: "remove", text: a[i - 1] })
      i--
    } else {
      out.push({ kind: "add", text: b[j - 1] })
      j--
    }
  }
  while (i > 0) {
    out.push({ kind: "remove", text: a[i - 1] })
    i--
  }
  while (j > 0) {
    out.push({ kind: "add", text: b[j - 1] })
    j--
  }
  return out.reverse()
}
