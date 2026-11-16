#!/usr/bin/env bun
// 从 packages/identity/ 品牌 artwork 一键再生成全部派生图标资产（favicon / identity PNG / 桌面三渠道 / 分享图）
// artwork 几何一致性由下方 GLYPH 断言守护：修改 master 几何时必须同步更新所有布局 SVG 与断言常量
import { Resvg } from "@resvg/resvg-js"
import { BILINEAR, createICNS, createICO } from "png2icons"
import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..")
const identityDir = join(root, "packages/identity")
const faviconDir = join(root, "packages/ui/src/assets/favicon")
const imagesDir = join(root, "packages/ui/src/assets/images")
const iconsRoot = join(root, "packages/desktop/icons")

// 方框藏书标准几何（packages/identity/*.svg 的全部图形文件必须与此一致）
const GLYPH = [
  "M128 128H384V384H128Z M192 192H320V320H192Z",
  'x="222" y="204" width="68" height="100"',
  'width="12" height="100"',
  'x="244" y="254" width="38" height="8"',
  'x="244" y="270" width="38" height="8"',
  "M254 288H266V304L260 312L254 304Z",
]

const read = (path: string) => Bun.file(path).text()
const write = (path: string, data: string | Uint8Array) => Bun.write(path, data)
const render = (svg: string, size: number) =>
  new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng()

const artwork = {
  mark: await read(join(identityDir, "mark.svg")),
  markLight: await read(join(identityDir, "mark-light.svg")),
  app: await read(join(identityDir, "app-icon.svg")),
  beta: await read(join(identityDir, "beta-icon.svg")),
  dev: await read(join(identityDir, "dev-icon.svg")),
  wordmark: await read(join(identityDir, "wordmark.svg")),
}

// 几何漂移守护：任一布局文件与标准几何脱节即失败，防止只改 master 漏改布局
for (const [name, svg] of Object.entries(artwork)) {
  if (name === "wordmark") continue
  for (const part of GLYPH) {
    if (!svg.includes(part)) throw new Error(`${name}.svg 缺少标准几何片段：${part.slice(0, 40)}…（修改 master 几何时需同步全部布局 SVG）`)
  }
}

const written: string[] = []
const emit = async (path: string, data: string | Uint8Array) => {
  await write(path, data)
  written.push(path)
}

// 1. identity PNG（mark 96/192/512 + mark-light 512）
await emit(join(identityDir, "mark-96x96.png"), render(artwork.mark, 96))
await emit(join(identityDir, "mark-192x192.png"), render(artwork.mark, 192))
await emit(join(identityDir, "mark-512x512.png"), render(artwork.mark, 512))
await emit(join(identityDir, "mark-512x512-light.png"), render(artwork.markLight, 512))

// 2. favicon 两系（v3 系被 index.html/favicon.tsx 引用，非 v3 系被 manifest/线上 URL 引用；两系同源同名内容）
const appleTouch = render(artwork.mark, 180)
await emit(join(faviconDir, "favicon.svg"), artwork.mark)
await emit(join(faviconDir, "favicon.ico"), createICO(render(artwork.mark, 1024), BILINEAR, 0, false, true))
await emit(join(faviconDir, "favicon-96x96.png"), render(artwork.mark, 96))
await emit(join(faviconDir, "apple-touch-icon.png"), appleTouch)
await emit(join(faviconDir, "web-app-manifest-192x192.png"), render(artwork.mark, 192))
await emit(join(faviconDir, "web-app-manifest-512x512.png"), render(artwork.mark, 512))
await emit(join(faviconDir, "favicon-v3.svg"), artwork.mark)
await emit(join(faviconDir, "favicon-v3.ico"), createICO(render(artwork.mark, 1024), BILINEAR, 0, false, true))
await emit(join(faviconDir, "favicon-96x96-v3.png"), render(artwork.mark, 96))
await emit(join(faviconDir, "apple-touch-icon-v3.png"), appleTouch)

// 3. 桌面三渠道（每渠道 18 个产物；beta 为浅色渠道，dev 为蓝图渠道）
const channelArt = { prod: artwork.app, beta: artwork.beta, dev: artwork.dev }
const squareSizes = [30, 44, 71, 89, 107, 142, 150, 284, 310]
for (const [channel, svg] of Object.entries(channelArt)) {
  const dir = join(iconsRoot, channel)
  const hi = render(svg, 1024)
  await emit(join(dir, "icon.png"), render(svg, 512))
  await emit(join(dir, "icon.ico"), createICO(hi, BILINEAR, 0, false, true))
  await emit(join(dir, "icon.icns"), createICNS(hi, BILINEAR, 0))
  await emit(join(dir, "dock.png"), render(svg, 256))
  await emit(join(dir, "32x32.png"), render(svg, 32))
  await emit(join(dir, "64x64.png"), render(svg, 64))
  await emit(join(dir, "128x128.png"), render(svg, 128))
  await emit(join(dir, "128x128@2x.png"), render(svg, 256))
  await emit(join(dir, "StoreLogo.png"), render(svg, 50))
  for (const size of squareSizes) await emit(join(dir, `Square${size}x${size}Logo.png`), render(svg, size))
}

// 4. 社交分享图 1200x630（深底用白色词标，浅底用原色词标）
const dataUri = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
const wordmarkOnDark = artwork.wordmark.replaceAll("#131010", "#FFFFFF").replaceAll("#5A5858", "#9A9898")
const share = (bg: string, art: string, word: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">` +
  `<rect width="1200" height="630" fill="${bg}"/>` +
  `<image href="${dataUri(art)}" x="110" y="75" width="480" height="480"/>` +
  `<image href="${dataUri(word)}" x="690" y="275" width="440" height="70"/></svg>`
await emit(join(imagesDir, "social-share.png"), render(share("#131010", artwork.mark, wordmarkOnDark), 1200))
await emit(join(imagesDir, "social-share-zen.png"), render(share("#F4F4F4", artwork.markLight, artwork.wordmark), 1200))

// 5. 产物清单一致性：目标目录不得残留矩阵外文件（site.webmanifest 为既有保留文件）
const expected = new Set(written.map((p) => p.replace(/\\/g, "/")))
const allowExtra = new Set([join(faviconDir, "site.webmanifest").replace(/\\/g, "/")])
for (const dir of [faviconDir, ...Object.keys(channelArt).map((c) => join(iconsRoot, c))]) {
  for (const file of readdirSync(dir)) {
    const full = join(dir, file)
    if (statSync(full).isDirectory()) continue
    const normalized = full.replace(/\\/g, "/")
    if (!expected.has(normalized) && !allowExtra.has(normalized)) throw new Error(`产物目录存在矩阵外残留文件：${normalized}`)
  }
}

console.log(`brand-icon: ${written.length} 个产物已再生成（identity 4 / favicon 10 / 桌面 54 / 分享图 2，含清单校验）`)
