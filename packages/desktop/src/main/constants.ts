import { app } from "electron"

import { resolveProductChannel } from "../../scripts/channel"
import { resolveUpdaterSettings } from "./updater-settings"

const raw = import.meta.env.OPENNOVEL_CHANNEL
export const CHANNEL = resolveProductChannel(raw)
export const UPDATER_SETTINGS = resolveUpdaterSettings(CHANNEL)
export const UPDATER_ENABLED = app.isPackaged && UPDATER_SETTINGS.enabled
