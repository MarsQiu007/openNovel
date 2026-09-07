import { BlobReader, BlobWriter, TextReader, ZipWriter } from "@zip.js/zip.js"
import type { ExportFormat } from "@opennovel-ai/schema/novel"
import { ChapterTable, NovelTable, VolumeTable } from "@opennovel-ai/novel-store"

export type NovelExportData = {
  novel: typeof NovelTable.$inferSelect
  volumes: (typeof VolumeTable.$inferSelect)[]
  chapters: (typeof ChapterTable.$inferSelect)[]
}

type NovelExportResult = {
  filename: string
  content: string
  encoding?: "utf8" | "base64"
}

type OrganizedChapters = {
  volumes: {
    volume: (typeof VolumeTable.$inferSelect)
    chapters: (typeof ChapterTable.$inferSelect)[]
  }[]
  orphan: (typeof ChapterTable.$inferSelect)[]
}

export async function buildNovelExport(data: NovelExportData, format: ExportFormat): Promise<NovelExportResult> {
  if (format === "epub") {
    const content = await buildNovelEpub(data)
    return { filename: safeFilename(data.novel.title, "epub"), content, encoding: "base64" }
  }
  if (format === "txt") {
    return { filename: safeFilename(data.novel.title, "txt"), content: buildNovelTxt(data), encoding: "utf8" }
  }
  return { filename: safeFilename(data.novel.title, "md"), content: buildNovelMarkdown(data) }
}

function organizeChapters(data: NovelExportData): OrganizedChapters {
  const withContent = data.chapters.filter((chapter) => chapter.content.trim().length > 0)
  const orphan = withContent.filter(
    (chapter) => !chapter.volume_id || !data.volumes.some((volume) => volume.id === chapter.volume_id),
  )
  return {
    volumes: data.volumes.map((volume) => ({
      volume,
      chapters: withContent.filter((chapter) => chapter.volume_id === volume.id),
    })),
    orphan,
  }
}

function buildNovelMarkdown(data: NovelExportData) {
  const organized = organizeChapters(data)
  const sections = [
    `# ${data.novel.title}`,
    data.novel.synopsis.trim(),
    ...organized.volumes.map(({ volume, chapters }) =>
      [`## ${volume.title}`, ...chapters.map(chapterMarkdown)].join("\n\n"),
    ),
    ...organized.orphan.map(chapterMarkdown),
  ]
  return sections.filter((section) => section.length > 0).join("\n\n") + "\n"
}

function chapterMarkdown(chapter: (typeof ChapterTable.$inferSelect)) {
  return `### ${chapter.title}\n\n${chapter.content.trim()}`
}

function buildNovelTxt(data: NovelExportData) {
  const organized = organizeChapters(data)
  const sections = [
    data.novel.title,
    data.novel.synopsis.trim(),
    ...organized.volumes.map(({ volume, chapters }) =>
      [volume.title, ...chapters.map((chapter) => `${chapter.title}\n${chapter.content.trim()}`)].join("\n\n"),
    ),
    ...organized.orphan.map((chapter) => `${chapter.title}\n${chapter.content.trim()}`),
  ]
  return sections.filter((section) => section.length > 0).join("\n\n") + "\n"
}

async function buildNovelEpub(data: NovelExportData) {
  const organized = organizeChapters(data)
  const chapters = [...organized.volumes.flatMap(({ chapters }) => chapters), ...organized.orphan]
  const writer = new ZipWriter(new BlobWriter("application/epub+zip"))
  await writer.add("mimetype", new TextReader("application/epub+zip"), { level: 0 })

  const entries = [
    { name: "META-INF/container.xml", content: epubContainer() },
    { name: "OEBPS/content.opf", content: epubContentOpf(data, chapters) },
    { name: "OEBPS/nav.xhtml", content: epubNav(data, organized) },
    { name: "OEBPS/toc.ncx", content: epubTocNcx(data, chapters) },
    ...chapters.map((chapter, index) => ({
      name: `OEBPS/chapter-${index + 1}.xhtml`,
      content: epubChapter(chapter.title, chapter.content),
    })),
  ]
  for (const entry of entries) {
    await writer.add(entry.name, new TextReader(entry.content))
  }
  const epub = await writer.close()
  return Buffer.from(await epub.arrayBuffer()).toString("base64")
}

function epubContainer() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`
}

function epubContentOpf(data: NovelExportData, chapters: (typeof ChapterTable.$inferSelect)[]) {
  const manifest = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>`,
    ...chapters.map(
      (_, index) => `<item id="chapter-${index + 1}" href="chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`,
    ),
  ].join("\n      ")
  const spine = chapters.map((_, index) => `<itemref idref="chapter-${index + 1}"/>`).join("\n      ")
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">urn:opennovel:${escapeXml(data.novel.id)}</dc:identifier>
    <dc:title>${escapeXml(data.novel.title)}</dc:title>
    <dc:creator>未知作者</dc:creator>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${epubTimestamp(data.novel.updated_at)}</meta>
  </metadata>
  <manifest>
      ${manifest}
  </manifest>
  <spine toc="ncx">
      ${spine}
  </spine>
</package>
`
}

function epubNav(data: NovelExportData, organized: OrganizedChapters) {
  const volumeItems = organized.volumes
    .filter(({ chapters }) => chapters.length > 0)
    .map(({ volume, chapters }) => {
      const items = chapters
        .map((chapter) => {
          const index = chapterNumber(chapter, organized)
          return `          <li><a href="chapter-${index}.xhtml">${escapeXml(chapter.title)}</a></li>`
        })
        .join("\n")
      return `        <li><span>${escapeXml(volume.title)}</span>\n          <ol>\n${items}\n          </ol>\n        </li>`
    })
  const orphanItems = organized.orphan.map((chapter) => {
    const index = chapterNumber(chapter, organized)
    return `        <li><a href="chapter-${index}.xhtml">${escapeXml(chapter.title)}</a></li>`
  })
  const items = [...volumeItems, ...orphanItems].join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN" xml:lang="zh-CN">
  <head><title>目录</title><meta charset="utf-8"/></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>
`
}

function epubTocNcx(data: NovelExportData, chapters: (typeof ChapterTable.$inferSelect)[]) {
  const navPoints = chapters
    .map((chapter, index) => {
      const playOrder = index + 1
      return `    <navPoint id="navPoint-${playOrder}" playOrder="${playOrder}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="chapter-${playOrder}.xhtml"/>
    </navPoint>`
    })
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:opennovel:${escapeXml(data.novel.id)}"/></head>
  <docTitle><text>${escapeXml(data.novel.title)}</text></docTitle>
  <navMap>
${navPoints}
  </navMap>
</ncx>
`
}

function epubChapter(title: string, content: string) {
  const paragraphs = content
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `      <p>${escapeXml(paragraph)}</p>`)
    .join("\n")
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN" xml:lang="zh-CN">
  <head><title>${escapeXml(title)}</title><meta charset="utf-8"/></head>
  <body>
    <section xmlns:epub="http://www.idpf.org/2007/ops" epub:type="chapter">
      <h1>${escapeXml(title)}</h1>
${paragraphs}
    </section>
  </body>
</html>
`
}

function chapterNumber(chapter: (typeof ChapterTable.$inferSelect), organized: OrganizedChapters) {
  const ordered = [...organized.volumes.flatMap(({ chapters }) => chapters), ...organized.orphan]
  return ordered.findIndex((item) => item.id === chapter.id) + 1
}

function epubTimestamp(timestamp: number) {
  const date = new Date(timestamp)
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString()
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function safeFilename(title: string, extension: string) {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/g, "").trim()
  return `${base || "novel"}.${extension}`
}