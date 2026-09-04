import { createEffect, createMemo, Show } from "solid-js"
import { useParams, useNavigate } from "@solidjs/router"
import { showToast } from "@/utils/toast"
import { useLanguage } from "@/context/language"
import { SDKProvider } from "@/context/sdk"
import { NovelProvider } from "@/context/novel"
import { DirectoryDataProvider, decodeDirectory } from "@/pages/directory-layout"
import NovelWorkspaceFrame from "./workspace-frame"
import NovelWizard from "./wizard"

export default function NovelWorkspaceLayout() {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decodeDirectory(params.dir) ?? ""
  })

  // 第三段只允许 "session"（/:dir/novel/:novelID/session/:id）；其余段位组合视为无效 URL，
  // 静默回书架（合并可选段路由前的 404 语义）
  createEffect(() => {
    const seg = params.seg
    if (seg === undefined || seg === "session") return
    navigate("/", { replace: true })
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={resolved}>
          <DirectoryDataProvider directory={resolved}>
            <NovelProvider>
              <NovelWorkspaceFrame />
            </NovelProvider>
          </DirectoryDataProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

export function NovelWizardLayout() {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decodeDirectory(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={resolved}>
          <NovelWizard />
        </SDKProvider>
      )}
    </Show>
  )
}
