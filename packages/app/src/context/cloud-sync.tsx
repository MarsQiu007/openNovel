import { onCleanup, onMount } from "solid-js"
import { useQueryClient } from "@tanstack/solid-query"
import { novelKeys, useNovelClient } from "./novel-queries"
import { useServerSDK } from "./server-sdk"
import { authTokenFromCredentials } from "@/utils/server"

export const cloudSyncKeys = {
  all: ["cloud-sync"] as const,
  status: () => ["cloud-sync", "status"] as const,
}

const AUTO_KEY = "opennovel.cloud-sync.auto"

export function cloudSyncAutoEnabled() {
  if (typeof localStorage === "undefined") return true
  return localStorage.getItem(AUTO_KEY) !== "0"
}

export function setCloudSyncAutoEnabled(value: boolean) {
  localStorage.setItem(AUTO_KEY, value ? "1" : "0")
}

const POLL_INTERVAL_MS = 60_000

export function createCloudSyncAutoPilot() {
  const client = useNovelClient()
  const serverSDK = useServerSDK()
  const queryClient = useQueryClient()

  // Decisions returned by run() are left for the settings page to resolve;
  // the autopilot never resolves conflicts on its own.
  const run = async () => {
    const outcome = await client()["server.sync"].run()
    await queryClient.invalidateQueries({ queryKey: cloudSyncKeys.all })
    if (!outcome.results.some((result) => result.action === "downloaded")) return
    await queryClient.invalidateQueries({ queryKey: novelKeys.all })
  }

  const autoRun = () => {
    if (!cloudSyncAutoEnabled()) return
    void run().catch((error) => console.error("[cloud-sync] auto sync failed", error))
  }

  onMount(autoRun)

  const timer = setInterval(() => {
    if (document.hidden) return
    autoRun()
  }, POLL_INTERVAL_MS)
  onCleanup(() => clearInterval(timer))

  // Best-effort sync on page unload; keepalive fetch outlives the page.
  const beacon = () => {
    if (!cloudSyncAutoEnabled()) return
    const server = serverSDK()
    const headers: Record<string, string> = { "content-type": "application/json" }
    if (server.server.http.password) {
      headers.Authorization = `Basic ${authTokenFromCredentials({
        username: server.server.http.username,
        password: server.server.http.password,
      })}`
    }
    fetch(new URL("/api/sync/run", server.url), {
      method: "POST",
      keepalive: true,
      headers,
      body: "{}",
    }).catch(() => {})
  }
  window.addEventListener("beforeunload", beacon)
  onCleanup(() => window.removeEventListener("beforeunload", beacon))
}
