/**
 * 多进程问题摄取 worker：由 issue-multiprocess.test.ts 以 bun 子进程启动。
 * argv[2] 为 JSON 任务；结束向 stdout 打一行 JSON 汇总，供父进程断言。
 */
import { makeFileDomain } from "@opennovel-ai/core/plugin/file"
import { toolInsightPaths } from "@opennovel-ai/novel-store"
import { issueFingerprint } from "@opennovel-ai/plugin/tool-insight/issue-doc"
import { ingestEvidenceIssue } from "@opennovel-ai/plugin/tool-insight/issue-store"

const task = JSON.parse(process.argv[2]!) as {
  logRoot: string
  workerID: string
  /** 证据/发生实例 ID 前缀：跨 worker 不同则各计一次，相同则按 ID 去重 */
  prefix: string
  count: number
  facts: { tool: string; scenario: string; errorCategory: string }
}

const file = makeFileDomain()
const paths = toolInsightPaths(task.logRoot)
const fingerprint = issueFingerprint(task.facts)
let documented = 0
let duplicates = 0
const base = Date.now()
for (let index = 0; index < task.count; index++) {
  const result = await ingestEvidenceIssue(file, paths, {
    fingerprint,
    evidenceID: `${task.prefix}-evi-${index}`,
    occurrenceID: `${task.prefix}-oci-${index}`,
    evidenceKind: "tool_failed",
    occurredAt: base + index,
    facts: task.facts,
  })
  if (result.documented) documented++
  else if (result.reason === "duplicate-evidence") duplicates++
}
console.log(JSON.stringify({ workerID: task.workerID, fingerprint, documented, duplicates }))
