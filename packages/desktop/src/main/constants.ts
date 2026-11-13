import { app } from "electron"

import { resolveProductChannel } from "../../scripts/channel"
import { resolveUpdaterSettings } from "./updater-settings"
import { gateAutoUpdate } from "./updater-signing"

const raw = import.meta.env.OPENNOVEL_CHANNEL
export const CHANNEL = resolveProductChannel(raw)
export const UPDATER_SETTINGS = resolveUpdaterSettings(CHANNEL)

const updateGate = gateAutoUpdate(process.platform, app.isPackaged)
if (!updateGate.allowed) console.log(`[updater] disabled: ${updateGate.reason}`)
export const UPDATER_ENABLED = app.isPackaged && UPDATER_SETTINGS.enabled && updateGate.allowed
