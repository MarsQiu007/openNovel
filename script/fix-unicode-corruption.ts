#!/usr/bin/env bun

// Restore all changed files to git HEAD state (clean slate)
// No replacements - just pure restoration to fix Unicode corruption

async function getAllChangedFiles(): Promise<string[]> {
  const proc = Bun.spawn(["git", "diff", "--name-only", "HEAD"], { stderr: "pipe" })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text.trim().split("\n").filter(Boolean)
}

async function getGitOriginal(filepath: string): Promise<Buffer | null> {
  const proc = Bun.spawn(["git", "show", `HEAD:${filepath}`], { stderr: "pipe" })
  const buf = await new Response(proc.stdout).arrayBuffer()
  const exitCode = await proc.exited
  if (exitCode !== 0) return null
  return Buffer.from(buf)
}

async function findCorruption(files: string[]): Promise<string[]> {
  const corrupted: string[] = []
  for (const f of files) {
    try {
      const content = await Bun.file(f).text()
      if (content.includes("\uFFFD")) corrupted.push(f)
    } catch {}
  }
  return corrupted
}

async function main() {
  console.log("=== Restoring all changed files to git HEAD ===\n")
  const files = await getAllChangedFiles()
  console.log(`Found ${files.length} changed files (vs HEAD)\n`)

  let restored = 0
  let skipped = 0
  let failed = 0

  for (const filepath of files) {
    try {
      const original = await getGitOriginal(filepath)
      if (!original) {
        console.log(`  ~ Skipped (new/untracked): ${filepath}`)
        skipped++
        continue
      }
      await Bun.write(filepath, original)
      restored++
    } catch (e: any) {
      console.error(`  ✗ Failed: ${filepath} - ${e.message}`)
      failed++
    }
  }

  console.log(`\nRestored: ${restored}, Skipped: ${skipped}, Failed: ${failed}`)

  console.log("\n=== Verifying no remaining corruption ===\n")
  const remaining = await findCorruption(files)
  if (remaining.length === 0) {
    console.log("✓ No U+FFFD characters remaining! All clean.")
  } else {
    console.log(`✗ ${remaining.length} files still have corruption:`)
    remaining.forEach((f) => console.log(`  - ${f}`))
  }

  console.log(`\n=== Summary ===`)
  console.log(`Total changed files: ${files.length}`)
  console.log(`Restored from HEAD: ${restored}`)
  console.log(`Remaining corruption: ${remaining.length}`)
}

main()
