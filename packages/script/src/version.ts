import semver from "semver"

/**
 * Resolve the base release version from the repo's `v*` tags.
 *
 * Prerelease suffixes are ignored (`v0.0.0-dev-202608240323` counts as
 * `0.0.0`) so legacy preview tags don't skew the baseline. Falls back to
 * `0.0.0` when there are no versioned tags yet.
 */
export function resolveBaseVersion(tags: string[]): string {
  const versions = tags
    .map((tag) => semver.coerce(tag))
    .filter((v): v is semver.SemVer => v !== null)
  if (versions.length === 0) return "0.0.0"
  return semver.rsort(versions)[0].format()
}

/**
 * Bump a release version by the given type (patch default).
 */
export function bumpVersion(version: string, bump: string | undefined): string {
  const t = bump?.toLowerCase()
  const type = t === "major" ? "major" : t === "minor" ? "minor" : "patch"
  return semver.inc(version, type) as string
}

/**
 * Build a preview channel version like `0.0.1-dev.20260831`.
 * Channel names may be branch names, so anything outside the semver
 * prerelease alphabet is replaced with `-`.
 */
export function previewVersion(base: string, channel: string, date: Date): string {
  const stamp = date.toISOString().slice(0, 10).replace(/-/g, "")
  const safeChannel = channel.replace(/[^0-9A-Za-z-]/g, "-")
  return `${base}-${safeChannel}.${stamp}`
}
