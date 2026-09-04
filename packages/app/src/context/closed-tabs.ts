import type { NovelTab, Tab } from "./tab-route"
import { tabKey } from "./tab-route"

export type ClosedTab = {
  tab: NovelTab
  index: number
}

const CLOSED_TAB_LIMIT = 25

export function pushClosedTab(stack: ClosedTab[], tab: Tab, index: number): ClosedTab[] {
  return [...stack, { tab: { ...tab }, index }].slice(-CLOSED_TAB_LIMIT)
}

// Pops the most recently closed tab that is not open again,
// discarding stale entries along the way.
export function takeClosedTab(stack: ClosedTab[], tabs: Tab[]): { entry?: ClosedTab; stack: ClosedTab[] } {
  const remaining = [...stack]
  while (remaining.length) {
    const entry = remaining.pop()
    if (entry && !isOpen(tabs, entry.tab)) return { entry, stack: remaining }
  }
  return { stack: remaining }
}

export function nextTabAfterClose(tabs: Tab[], index: number, active: boolean) {
  if (!active) return undefined
  return tabs[index + 1] ?? tabs[index - 1] ?? null
}

function isOpen(tabs: Tab[], tab: ClosedTab["tab"]) {
  return tabs.some((item) => tabKey(item) === tabKey(tab))
}
