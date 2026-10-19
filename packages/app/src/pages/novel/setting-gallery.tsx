/**
 * 设定图片画廊（setting-entry-gallery）。
 *
 * 世界观条目与角色的「画廊」标签视图：网格缩略图、上传、大图预览
 * （说明编辑 / 上移下移 / 两步删除确认）、空态引导；图片内容按 imageID 懒加载。
 * 角色头像（CharacterAvatar）也在此导出，供角色列表与详情复用。
 */
import { type Accessor, createMemo, createSignal, For, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { showToast } from "@/utils/toast"
import {
  useDeleteSettingImage,
  useReorderSettingImages,
  useSettingImageContent,
  useSettingImages,
  useUpdateSettingImageNote,
  useUploadSettingImage,
} from "@/context/novel-queries"
import { ButtonV2 } from "@opennovel-ai/ui/v2/button-v2"
import { Spinner } from "@opennovel-ai/ui/spinner"
import { TextInputV2 } from "@opennovel-ai/ui/v2/text-input-v2"
import type { SettingImageOwnerType } from "@opennovel-ai/schema/novel"
import { avatarOf, moveItem, validateImageFile } from "./setting-gallery-data"

export type SettingGalleryProps = {
  novelID: Accessor<string>
  ownerType: SettingImageOwnerType
  ownerID: Accessor<string>
}

const FILE_ERROR_KEYS = {
  tooLarge: "novel.settings.gallery.errorTooLarge",
  badType: "novel.settings.gallery.errorBadType",
}

function readFileDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "")
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export function SettingGallery(props: SettingGalleryProps) {
  const language = useLanguage()
  const imagesQuery = useSettingImages(props.novelID, () => props.ownerType, props.ownerID)
  const images = createMemo(() => imagesQuery.data?.images ?? [])
  const upload = useUploadSettingImage(props.novelID)
  const removeImage = useDeleteSettingImage(props.novelID)
  const reorder = useReorderSettingImages(props.novelID)
  const updateNote = useUpdateSettingImageNote(props.novelID)

  const [previewId, setPreviewId] = createSignal<string | null>(null)
  const [noteDraft, setNoteDraft] = createSignal("")
  const [confirmingDelete, setConfirmingDelete] = createSignal(false)

  const previewImage = createMemo(() => images().find((image) => image.id === previewId()))

  const openPreview = (id: string) => {
    setPreviewId(id)
    setNoteDraft(images().find((image) => image.id === id)?.note ?? "")
    setConfirmingDelete(false)
  }

  const closePreview = () => {
    setPreviewId(null)
    setConfirmingDelete(false)
  }

  const notifyError = () => showToast({ variant: "error", title: language.t("novel.settings.gallery.errorFailed") })

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    const invalid = validateImageFile(file)
    if (invalid) {
      showToast({ variant: "error", title: language.t(FILE_ERROR_KEYS[invalid]) })
      return
    }
    const dataUrl = await readFileDataUrl(file)
    await upload
      .mutateAsync({ ownerType: props.ownerType, ownerID: props.ownerID(), filename: file.name, dataUrl })
      .catch(notifyError)
  }

  const saveNote = async () => {
    const image = previewImage()
    if (!image) return
    await updateNote
      .mutateAsync({ ownerType: props.ownerType, ownerID: props.ownerID(), imageID: image.id, note: noteDraft() })
      .then(() => showToast({ variant: "success", title: language.t("novel.settings.gallery.noteSaved") }))
      .catch(notifyError)
  }

  const move = async (id: string, delta: -1 | 1) => {
    await reorder
      .mutateAsync({
        ownerType: props.ownerType,
        ownerID: props.ownerID(),
        orderedIds: moveItem(images().map((image) => image.id), id, delta),
      })
      .catch(notifyError)
  }

  const confirmDelete = async () => {
    const image = previewImage()
    if (!image) return
    await removeImage
      .mutateAsync({ ownerType: props.ownerType, ownerID: props.ownerID(), imageID: image.id })
      .then(() => {
        closePreview()
        showToast({ variant: "success", title: language.t("novel.settings.gallery.deleted") })
      })
      .catch(notifyError)
  }

  let fileInput: HTMLInputElement | undefined

  return (
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6" data-testid="setting-gallery">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-v2-text-text-base">{language.t("novel.settings.gallery.title")}</h3>
        <ButtonV2
          variant="contrast"
          size="small"
          disabled={upload.isPending}
          onClick={() => fileInput?.click()}
          data-testid="gallery-upload-button"
        >
          {upload.isPending ? language.t("novel.settings.gallery.uploading") : language.t("novel.settings.gallery.upload")}
        </ButtonV2>
        <input
          ref={fileInput}
          type="file"
          class="hidden"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => void handleFiles(e.currentTarget.files)}
        />
      </div>

      <Show
        when={images().length > 0}
        fallback={
          <p class="rounded border border-dashed border-v2-border-border-base px-4 py-10 text-center text-sm text-v2-text-text-muted" data-testid="gallery-empty">
            {language.t("novel.settings.gallery.empty")}
          </p>
        }
      >
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <For each={images()}>
            {(image) => (
              <GalleryThumb novelID={props.novelID} imageID={image.id} onClick={() => openPreview(image.id)} />
            )}
          </For>
        </div>
      </Show>

      <Show when={previewImage()} keyed>
        {(image) => (
          <div
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
            onClick={closePreview}
            data-testid="gallery-preview"
          >
            <div
              class="flex max-h-full w-full max-w-2xl flex-col gap-3 overflow-y-auto rounded-lg border border-v2-border-border-base bg-v2-background-bg-layer-01 p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <GalleryImage novelID={props.novelID} imageID={image.id} class="max-h-[60vh] w-full self-center rounded object-contain" />
              <p class="text-xs text-v2-text-text-muted">
                {image.filename || image.id} · {language.t("novel.settings.gallery.size", { bytes: image.bytes })}
              </p>
              <div class="flex flex-wrap items-center gap-2">
                <ButtonV2 variant="outline" size="small" onClick={() => void move(image.id, -1)}>
                  {language.t("novel.settings.gallery.moveUp")}
                </ButtonV2>
                <ButtonV2 variant="outline" size="small" onClick={() => void move(image.id, 1)}>
                  {language.t("novel.settings.gallery.moveDown")}
                </ButtonV2>
                <Show
                  when={confirmingDelete()}
                  fallback={
                    <ButtonV2 variant="ghost-muted" size="small" onClick={() => setConfirmingDelete(true)}>
                      {language.t("novel.settings.gallery.delete")}
                    </ButtonV2>
                  }
                >
                  <span class="text-xs text-v2-state-fg-danger">{language.t("novel.settings.gallery.deleteConfirm")}</span>
                  <ButtonV2 variant="ghost-muted" size="small" onClick={() => void confirmDelete()} data-testid="gallery-delete-confirm">
                    {language.t("common.action.confirm")}
                  </ButtonV2>
                  <ButtonV2 variant="ghost" size="small" onClick={() => setConfirmingDelete(false)}>
                    {language.t("common.action.cancel")}
                  </ButtonV2>
                </Show>
                <ButtonV2 variant="ghost" size="small" class="ml-auto" onClick={closePreview}>
                  {language.t("common.close")}
                </ButtonV2>
              </div>
              <div class="flex items-end gap-2">
                <TextInputV2
                  fluid
                  value={noteDraft()}
                  onInput={(e) => setNoteDraft(e.currentTarget.value)}
                  placeholder={language.t("novel.settings.gallery.notePlaceholder")}
                  data-testid="gallery-note-input"
                />
                <ButtonV2 variant="contrast" size="small" disabled={updateNote.isPending} onClick={() => void saveNote()}>
                  {language.t("novel.settings.gallery.noteSave")}
                </ButtonV2>
              </div>
            </div>
          </div>
        )}
      </Show>
    </div>
  )
}

/** 单张缩略图：按 imageID 懒加载内容。 */
function GalleryThumb(props: { novelID: Accessor<string>; imageID: string; onClick: () => void }) {
  const content = useSettingImageContent(props.novelID, () => props.imageID, () => true)
  return (
    <button
      type="button"
      class="aspect-square overflow-hidden rounded border border-v2-border-border-base bg-v2-background-bg-layer-02"
      onClick={props.onClick}
      data-testid="gallery-thumb"
      data-image-id={props.imageID}
    >
      <Show
        when={!content.isLoading}
        fallback={
          <div class="flex h-full items-center justify-center">
            <Spinner class="w-4 h-4 text-v2-text-text-muted" />
          </div>
        }
      >
        <img src={content.data?.dataUrl} alt="" class="h-full w-full object-cover" loading="lazy" />
      </Show>
    </button>
  )
}

/** 预览/头像共用的原图渲染。 */
function GalleryImage(props: { novelID: Accessor<string>; imageID: string; class?: string }) {
  const content = useSettingImageContent(props.novelID, () => props.imageID, () => true)
  return <img src={content.data?.dataUrl} alt="" class={props.class} data-testid="gallery-image" />
}

/** 角色头像：排序最前的图片，无图回退首字占位。 */
export function CharacterAvatar(props: {
  novelID: Accessor<string>
  characterID: string
  name: string
  class?: string
}) {
  const images = useSettingImages(props.novelID, () => "character" as const, () => props.characterID)
  const avatarId = createMemo(() => avatarOf(images.data?.images ?? []))
  return (
    <Show
      when={avatarId()}
      keyed
      fallback={
        <span
          class={`flex shrink-0 items-center justify-center rounded-full bg-v2-background-bg-layer-02 text-xs font-medium text-v2-text-text-muted ${props.class ?? "h-8 w-8"}`}
        >
          {props.name.slice(0, 1)}
        </span>
      }
    >
      {(id) => <GalleryImage novelID={props.novelID} imageID={id} class={`shrink-0 rounded-full object-cover ${props.class ?? "h-8 w-8"}`} />}
    </Show>
  )
}
