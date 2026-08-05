import { resolveChannel } from "./utils"

const arg = process.argv[2]
const channel = arg === "dev" || arg === "beta" || arg === "prod" ? arg : resolveChannel()

const appId = channel === "prod" ? "ai.opennovel.desktop" : `ai.opennovel.desktop.${channel}`
const productName = channel === "prod" ? "OpenNovel" : `OpenNovel ${channel.charAt(0).toUpperCase() + channel.slice(1)}`
const summary = `AI-powered novel writing workbench${channel !== "prod" ? ` (${channel})` : ""}`

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${appId}</id>

  <metadata_license>CC0-1.0</metadata_license>
  <project_license>MIT</project_license>

  <name>${productName}</name>
  <summary>${summary}</summary>

  <developer id="marsqiu007">
    <name>openNovel contributors</name>
  </developer>

  <description>
    <p>
      openNovel is an AI-powered novel writing workbench.
    </p>
  </description>

  <launchable type="desktop-id">${appId}.desktop</launchable>

  <content_rating type="oars-1.1" />

  <url type="bugtracker">https://github.com/MarsQiu007/openNovel/issues</url>
  <url type="homepage">https://github.com/MarsQiu007/openNovel</url>
  <url type="vcs-browser">https://github.com/MarsQiu007/openNovel</url>

  <screenshots>
    <screenshot type="default">
      <image>https://raw.githubusercontent.com/MarsQiu007/openNovel/dev/docs/screenshots/workspace.png</image>
    </screenshot>
  </screenshots>
</component>
`

await Bun.write(`resources/${appId}.metainfo.xml`, xml)
console.log(`Generated metainfo for ${channel} at resources/${appId}.metainfo.xml`)
