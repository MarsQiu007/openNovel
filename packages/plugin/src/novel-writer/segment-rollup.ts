/**
 * 章节段摘要模块（实现已下沉至 @opennovel-ai/novel-store）。
 *
 * 升级回填（derived-data-upgrade）需要在 server 可达的存储层复用
 * 段摘要重建；本文件保留 re-export 以维持 plugin 既有 import 路径。
 */
export {
  SEGMENT_WINDOW,
  ensureSegmentSummaries,
  listSegmentSummaries,
  type SegmentSummaryItem,
} from "@opennovel-ai/novel-store"
