/**
 * 写作防漂移守卫。
 *
 * 该模块提供跨 writer / auditor / observer / 状态提交共用的角色绑定视图，
 * 以及针对亲属称谓实体化和强关系冲突的保守确定性检查。
 */
import { eq } from "drizzle-orm"
import type { RelationshipSummary } from "./context.js"
import {
  selectProtectedRelationships,
  toProtectedRelationship,
  type ProtectedKinshipBinding,
  type ProtectedRelationship,
} from "./relationship-context.js"
import { CharacterTable, CharacterStateTable, RelationshipTable, getDb } from "./session-store.js"

type Db = ReturnType<typeof getDb>

/** 命名角色白名单条目 */
export type NamedCharacterBinding = {
  id: string
  name: string
  active: boolean
  outlineRelevant: boolean
}

/** writer、auditor 和状态提交共用的角色绑定视图 */
export type CharacterBindingView = {
  characters: NamedCharacterBinding[]
  relationships: RelationshipSummary[]
  protectedRelationships: ProtectedRelationship[]
  kinshipBindings: ProtectedKinshipBinding[]
  ambiguousKinshipTerms: string[]
}

/** 角色引用解析结果 */
export type CharacterReferenceResult =
  | { status: "resolved"; characterId: string; characterName: string }
  | { status: "unresolved"; reason: string }

/** 章节守卫发现的疑似称谓实体化问题 */
export type KinshipEntityGuardFinding = {
  term: string
  evidence: string
  boundCharacterName: string | null
  message: string
}

/** 关系冲突检查结果 */
export type RelationshipConflictFinding = {
  existingRelationshipId: string
  reason: string
}

const KINSHIP_TERMS = ["母亲", "妈妈", "老妈", "父亲", "爸爸", "老爸", "儿子", "女儿"] as const

export function isKinshipTerm(term: string): boolean {
  return (KINSHIP_TERMS as readonly string[]).includes(term.trim())
}

/** 去除重复角色，同时保留活跃与章纲相关信号 */
export function buildCharacterBindingView(input: {
  characters: Array<{ id: string; name: string }>
  activeCharacterIds: string[]
  relatedText: string
  relationships: RelationshipSummary[]
  protectedRelationships: ProtectedRelationship[]
}): CharacterBindingView {
  const activeIds = new Set(input.activeCharacterIds)
  const characters = input.characters.map((character) => ({
    id: character.id,
    name: character.name,
    active: activeIds.has(character.id),
    outlineRelevant: character.name.length > 0 && input.relatedText.includes(character.name),
  }))

  const bindingCandidates = new Map<string, Map<string, string>>()
  for (const relationship of input.protectedRelationships) {
    for (const binding of relationship.kinshipBindings) {
      const byId = bindingCandidates.get(binding.term) ?? new Map<string, string>()
      byId.set(binding.characterId, binding.characterName)
      bindingCandidates.set(binding.term, byId)
    }
  }

  const kinshipBindings: ProtectedKinshipBinding[] = []
  const ambiguousKinshipTerms: string[] = []
  for (const [term, byId] of bindingCandidates) {
    if (byId.size === 1) {
      const [characterId, characterName] = [...byId.entries()][0]
      kinshipBindings.push({ term, characterId, characterName })
    } else {
      ambiguousKinshipTerms.push(term)
    }
  }

  return {
    characters,
    relationships: input.relationships,
    protectedRelationships: input.protectedRelationships,
    kinshipBindings,
    ambiguousKinshipTerms: [...new Set([...input.protectedRelationships.flatMap((r) => r.unresolvedKinshipTerms), ...ambiguousKinshipTerms])],
  }
}

/** 从数据库加载完整绑定视图；relatedText 用于标记章纲相关角色 */
export async function loadCharacterBindingView(
  db: Db,
  novelId: string,
  relatedText: string,
  activeCharacterIds: string[] = [],
): Promise<CharacterBindingView> {
  const characters = await db.select({ id: CharacterTable.id, name: CharacterTable.name }).from(CharacterTable).where(eq(CharacterTable.novel_id, novelId)).all()
  const states = await db
    .select({ character_id: CharacterStateTable.character_id, active: CharacterStateTable.active })
    .from(CharacterStateTable)
    .all()
  const characterIds = new Set(characters.map((c) => c.id))
  const activeFromStates = new Set(states.filter((s) => s.active === 1 && characterIds.has(s.character_id)).map((s) => s.character_id))

  const relationshipRows = await db.select().from(RelationshipTable).where(eq(RelationshipTable.novel_id, novelId)).all()
  const nameById = new Map(characters.map((c) => [c.id, c.name]))
  const relationships: RelationshipSummary[] = relationshipRows.map((row) => ({
    id: row.id,
    charAId: row.char_a_id,
    charBId: row.char_b_id,
    type: row.type,
    description: row.description,
    charAName: nameById.get(row.char_a_id) ?? "(未知角色)",
    charBName: nameById.get(row.char_b_id) ?? "(未知角色)",
  }))

  const mergedActiveIds = [...new Set([...activeCharacterIds, ...activeFromStates])]
  const protectedRelationships = selectProtectedRelationships({
    relationships,
    activeCharacterIds: mergedActiveIds,
    relatedText,
  })

  return buildCharacterBindingView({ characters, activeCharacterIds: mergedActiveIds, relatedText, relationships, protectedRelationships })
}

/** 状态提交使用的完整绑定视图：不按活跃或章纲过滤，确保候选兜底能对照全部正式关系 */
export async function loadFullCharacterBindingView(db: Db, novelId: string, relatedText = ""): Promise<CharacterBindingView> {
  const characterIds = await db
    .select({ id: CharacterTable.id })
    .from(CharacterTable)
    .where(eq(CharacterTable.novel_id, novelId))
    .all()
  return loadCharacterBindingView(db, novelId, relatedText, characterIds.map((character) => character.id))
}

/**
 * 解析 observer 提交的角色引用。
 * 优先级：既有 UUID → 唯一姓名 → 唯一亲属称谓；无法唯一解析时保守返回未解析。
 */
export function resolveCharacterReference(
  view: CharacterBindingView,
  input: { entityId: string; name?: string | null; kinshipTerm?: string | null },
): CharacterReferenceResult {
  const byId = view.characters.find((character) => character.id === input.entityId)
  if (byId) return { status: "resolved", characterId: byId.id, characterName: byId.name }

  const term = input.kinshipTerm ?? input.name
  if (term && isKinshipTerm(term)) {
    const binding = view.kinshipBindings.find((candidate) => candidate.term === term.trim())
    if (binding) return { status: "resolved", characterId: binding.characterId, characterName: binding.characterName }
    if (view.ambiguousKinshipTerms.includes(term.trim())) return { status: "unresolved", reason: `称谓“${term.trim()}”存在多个既有角色候选` }
    return { status: "unresolved", reason: `称谓“${term.trim()}”没有唯一绑定的既有角色` }
  }

  const name = input.name?.trim()
  if (name) {
    const byName = view.characters.filter((character) => character.name === name)
    if (byName.length === 1) return { status: "resolved", characterId: byName[0].id, characterName: byName[0].name }
    if (byName.length > 1) return { status: "unresolved", reason: `角色名“${name}”存在多个既有角色候选` }
  }
  return { status: "unresolved", reason: "既有 UUID、姓名和亲属称谓均无法唯一解析" }
}

function sentences(text: string): string[] {
  return text
    .split(/[。！？!?\n\r]+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

function entityMarkers(sentence: string): boolean {
  return /(?:是|成了|成为|名叫|名字叫|叫做|叫作|名为)(?:一名|一个)?/.test(sentence)
}

/**
 * 检查正文是否把关系派生称谓实体化为新的、未绑定角色。
 * 只检查“称谓 + 实体化动词”的显式表述；普通对话称谓不触发。
 */
export function detectKinshipEntityDrift(content: string, view: CharacterBindingView): KinshipEntityGuardFinding[] {
  const findings: KinshipEntityGuardFinding[] = []
  const terms = [
    ...view.kinshipBindings.map((binding) => binding.term),
    ...view.ambiguousKinshipTerms,
  ]
  const seenEvidence = new Set<string>()

  for (const sentence of sentences(content)) {
    for (const term of new Set(terms)) {
      if (!sentence.includes(term) || !entityMarkers(sentence)) continue
      const binding = view.kinshipBindings.find((candidate) => candidate.term === term)
      const explicitBinding = binding ? sentence.includes(binding.characterName) : false
      if (binding && explicitBinding) continue

      const evidence = sentence
      if (seenEvidence.has(`${term}:${evidence}`)) continue
      seenEvidence.add(`${term}:${evidence}`)
      findings.push({
        term,
        evidence,
        boundCharacterName: binding?.characterName ?? null,
        message: binding
          ? `称谓“${term}”应绑定到“${binding.characterName}”，但该句未使用既有角色名。`
          : `称谓“${term}”无法唯一绑定既有角色，请交由 auditor 继续审计。`,
      })
    }
  }
  return findings
}

/** 从既有关系和候选新关系中查找亲属方向冲突 */
export function findRelationshipConflicts(
  relationships: RelationshipSummary[],
  candidate: { id: string; charAId: string; charBId: string; type: string; description: string },
): RelationshipConflictFinding[] {
  const candidateRoles = kinshipEndpointIds(toProtectedRelationship({ ...candidate, charAName: "A", charBName: "B" }))
  const conflicts: RelationshipConflictFinding[] = []
  const candidatePair = new Set([candidate.charAId, candidate.charBId])

  for (const relationship of relationships) {
    if (relationship.id === candidate.id) continue
    const existingPair = new Set([relationship.charAId, relationship.charBId])
    if (
      candidatePair.size === 2 &&
      existingPair.size === 2 &&
      [...candidatePair].every((id) => existingPair.has(id)) &&
      relationship.type !== candidate.type
    ) {
      conflicts.push({
        existingRelationshipId: relationship.id,
        reason: `双方已有“${relationship.type}”关系，与候选“${candidate.type}”冲突`,
      })
      continue
    }

    const existingRoles = kinshipEndpointIds(relationship)
    if (!existingRoles || !candidateRoles) continue
    if (existingRoles.parentId && existingRoles.childId && candidateRoles.parentId && candidateRoles.childId) {
      if (existingRoles.parentId === candidateRoles.parentId && existingRoles.childId !== candidateRoles.childId) {
        conflicts.push({
          existingRelationshipId: relationship.id,
          reason: "同一家长已绑定唯一子女，候选关系引入了另一个子女",
        })
      }
      if (existingRoles.childId === candidateRoles.childId && existingRoles.parentId !== candidateRoles.parentId) {
        conflicts.push({
          existingRelationshipId: relationship.id,
          reason: "同一子女已绑定唯一家长，候选关系引入了另一个家长",
        })
      }
    }
  }
  return conflicts
}

function kinshipEndpointIds(
  relationship: Pick<RelationshipSummary, "id" | "charAId" | "charBId" | "type" | "description" | "charAName" | "charBName">,
): { parentId: string; childId: string } | null {
  const protectedRelationship = toProtectedRelationship(relationship)
  const parentBinding = protectedRelationship.kinshipBindings.find((binding) => binding.term === "母亲" || binding.term === "父亲")
  const childBinding = protectedRelationship.kinshipBindings.find((binding) => binding.term === "儿子" || binding.term === "女儿")
  if (!parentBinding || !childBinding) return null
  return { parentId: parentBinding.characterId, childId: childBinding.characterId }
}
