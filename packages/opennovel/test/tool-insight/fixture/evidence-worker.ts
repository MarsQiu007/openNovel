/**
 * 多进程证据写入 worker：由 evidence-multiprocess.test.ts 以 bun 子进程启动。
 * argv[2] 为 JSON 任务；结束向 stdout 打一行 JSON 汇总，供父进程断言。
 */
import { makeFileDomain } from "@opennovel-ai/core/plugin/file"
import { toolInsightPaths } from "@opennovel-ai/novel-store"
import { appendEvidenceUnderLock } from "@opennovel-ai/plugin/tool-insight/evidence-store"

const task = JSON.parse(process.argv[2]!) as {
  logRoot: string
  workerID: string
  batches: number
  recordsPerBatch: number
  timeoutMs?: number
}

const file = makeFileDomain()
const paths = toolInsightPaths(task.logRoot)
let appended = 0
const outcomes: Record<string, number> = {}
for (let index = 0; index < task.batches; index++) {
  const records = Array.from({ length: task.recordsPerBatch }, (_, offset) => ({
    id: `${task.workerID}-${index}-${offset}`,
  }))
  const result = await appendEvidenceUnderLock(file, paths, records, { timeoutMs: task.timeoutMs })
  if (result.appended) {
    appended++
  } else {
    outcomes[result.reason] = (outcomes[result.reason] ?? 0) + 1
  }
}
console.log(JSON.stringify({ workerID: task.workerID, appended, outcomes }))
