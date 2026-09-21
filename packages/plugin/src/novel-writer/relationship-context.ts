/**
 * 受保护角色关系上下文。
 *
 * 该模块只使用关系表现有字段做确定性方向解析与排序，
 * 不修改数据库 schema，也不引入通用角色别名表。
 */
import type { RelationshipSummary } from "./context.js"

/** 关系派生的亲属称谓绑定，仅在既有命名角色唯一匹配时保留 */
export type ProtectedKinshipBinding = {
  term: string
  characterId: string
  characterName: string
}

/** 进入硬约束区的正式角色关系 */
export type ProtectedRelationship = {
  id: string
  charAId: string
  charAName: string
  charBId: string
  charBName: string
  type: string
  description: string
  /** 方向可解析时的自然语言表述，例如“张三是李四的母亲” */
  directionText: string | null
  directionResolved: boolean
  kinshipBindings: ProtectedKinshipBinding[]
  /** 方向或称谓存在歧义时显式暴露，禁止生成器虚构方向 */
  unresolvedKinshipTerms: string[]
}

/** 关系端点在亲属关系中的角色 */
type KinshipRole = "mother" | "father" | "son" | "daughter"

const ROLE_LABELS: Record<KinshipRole, string> = {
  mother: "母亲",
  father: "父亲",
  son: "儿子",
  daughter: "女儿",
}

const ROLE_TERMS: KinshipRole[] = ["mother", "father", "son", "daughter"]

const ROLE_TERMS_BY_ROLE: Record<KinshipRole, string[]> = {
  mother: ["母亲", "妈妈", "老妈"],
  father: ["父亲", "爸爸", "老爸"],
  son: ["儿子"],
  daughter: ["女儿"],
}

/** 中文复合关系类型约定：前一字是角色 A，后一字是角色 B */
const COMPOUND_PARENT_CHILD_TYPES: Record<string, [KinshipRole, KinshipRole]> = {
  母子: ["mother", "son"],
  母女: ["mother", "daughter"],
  父子: ["father", "son"],
  父女: ["father", "daughter"],
}

function roleTerms(text: string): KinshipRole[] {
  return ROLE_TERMS.filter((role) => ROLE_TERMS_BY_ROLE[role].some((term) => text.includes(term)))
}

function compactDescription(description: string): string {
  return description.replace(/\s+/g, "")
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * 找出描述中归属于角色名的称谓。
 *
 * 中文表述分两类：<角色名>是...<称谓> 表示角色本身是该称谓；
 * <角色名>的<称谓> 表示称谓属于另一方，不能归到角色名。
 */
function endpointRole(description: string, characterName: string): KinshipRole | null {
  const compact = compactDescription(description)
  if (!compact.includes(characterName)) return null

  const escapedName = escapeRegExp(characterName)
  const alternation = ROLE_TERMS.flatMap((role) => ROLE_TERMS_BY_ROLE[role]).join("|")
  const isSubjectRole = new RegExp(`${escapedName}(?:是|叫|为)[^。！？，,;；]{0,16}(${alternation})`)
  const rolePrecedesName = new RegExp(`(${alternation})(?:的)?${escapedName}`)
  const roleBelongsToOther = new RegExp(`${escapedName}的(${alternation})`)

  const subjectMatch = isSubjectRole.exec(compact)
  if (subjectMatch?.[1]) return roleTerms(subjectMatch[1])[0] ?? null
  if (roleBelongsToOther.test(compact)) return null

  const precedesMatch = rolePrecedesName.exec(compact)
  if (precedesMatch?.[1]) return roleTerms(precedesMatch[1])[0] ?? null
  return null
}

type DirectionRoles = { charA?: KinshipRole; charB?: KinshipRole }

/**
 * 解析亲属方向。
 *
 * 优先信任描述中“角色名 + 称谓”的表述，其次使用母子/父子等复合类型的约定顺序；
 * 只能解析单侧称谓时也保守返回该侧，不虚构另一侧性别称谓。
 */
export function resolveKinshipDirection(
  relationship: Pick<RelationshipSummary, "type" | "description" | "charAName" | "charBName">,
): DirectionRoles | null {
  const compoundRoles = COMPOUND_PARENT_CHILD_TYPES[relationship.type.trim()]
  if (compoundRoles) return { charA: compoundRoles[0], charB: compoundRoles[1] }

  const charA = endpointRole(relationship.description, relationship.charAName)
  const charB = endpointRole(relationship.description, relationship.charBName)
  if (!charA && !charB) return null
  const roles: DirectionRoles = {}
  if (charA) roles.charA = charA
  if (charB) roles.charB = charB
  return roles
}

/** 将普通关系转换为可保护的内部结构，并做确定性方向解析 */
export function toProtectedRelationship(relationship: RelationshipSummary): ProtectedRelationship {
  const direction = resolveKinshipDirection(relationship)
  const bindings: ProtectedKinshipBinding[] = []
  const statements: string[] = []

  const appendEndpoint = (role: KinshipRole, name: string, otherName: string, id: string) => {
    statements.push(`${name}是${otherName}的${ROLE_LABELS[role]}`)
    bindings.push({ term: ROLE_LABELS[role], characterId: id, characterName: name })
  }

  if (direction?.charA) {
    appendEndpoint(direction.charA, relationship.charAName, relationship.charBName, relationship.charAId)
  }
  if (direction?.charB) {
    appendEndpoint(direction.charB, relationship.charBName, relationship.charAName, relationship.charBId)
  }

  return {
    ...relationship,
    directionText: statements.length > 0 ? statements.join("，") : null,
    directionResolved: statements.length > 0,
    kinshipBindings: bindings,
    unresolvedKinshipTerms: [],
  }
}

/** 关系筛选输入；relatedText 由章纲和最近章节摘要拼接而成 */
export type RelationshipSelectionInput = {
  relationships: RelationshipSummary[]
  activeCharacterIds: string[]
  relatedText: string
}

/**
 * 跨受保护关系保守推导称谓绑定。
 * 同一称谓对应多个既有角色时不保留绑定，并让相关关系显式标记未解析。
 */
function deriveKinshipBindings(relationships: ProtectedRelationship[]): void {
  const candidates = new Map<string, Map<string, string>>()
  for (const relationship of relationships) {
    for (const binding of relationship.kinshipBindings) {
      const byId = candidates.get(binding.term) ?? new Map<string, string>()
      byId.set(binding.characterId, binding.characterName)
      candidates.set(binding.term, byId)
    }
  }

  for (const relationship of relationships) {
    const originalTerms = relationship.kinshipBindings.map((binding) => binding.term)
    relationship.kinshipBindings = relationship.kinshipBindings.filter(
      (binding) => candidates.get(binding.term)?.size === 1,
    )
    const boundTerms = new Set(relationship.kinshipBindings.map((binding) => binding.term))
    relationship.unresolvedKinshipTerms = [...new Set(originalTerms.filter((term) => !boundTerms.has(term)))]
  }
}

/**
 * 选择本章相关关系并排序。
 *
 * 排序优先级：双方活跃 → 单方活跃 → 章纲/最近章节中的角色名、关系类型或亲属称谓命中。
 */
export function selectProtectedRelationships(input: RelationshipSelectionInput): ProtectedRelationship[] {
  const activeIds = new Set(input.activeCharacterIds)
  const selected: Array<{ relationship: ProtectedRelationship; priority: number }> = []

  for (const relationship of input.relationships) {
    const aActive = activeIds.has(relationship.charAId)
    const bActive = activeIds.has(relationship.charBId)
    const keywordHit =
      input.relatedText.includes(relationship.charAName) ||
      input.relatedText.includes(relationship.charBName) ||
      relationshipKeywords(relationship).some((keyword) => keyword.length > 0 && input.relatedText.includes(keyword))
    const priority = aActive && bActive ? 0 : aActive || bActive ? 1 : keywordHit ? 2 : -1
    if (priority < 0) continue

    selected.push({ relationship: toProtectedRelationship(relationship), priority })
  }

  deriveKinshipBindings(selected.map((item) => item.relationship))

  return selected
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.relationship.charAId.localeCompare(b.relationship.charAId) ||
        a.relationship.charBId.localeCompare(b.relationship.charBId),
    )
    .map((item) => item.relationship)
}

/** 供测试和调用方核对某个关系使用的确定性关键词 */
export function relationshipKeywords(relationship: Pick<RelationshipSummary, "type" | "description">): string[] {
  return [
    relationship.type,
    relationship.description,
    ...roleTerms(`${relationship.type} ${relationship.description}`).flatMap((role) => ROLE_TERMS_BY_ROLE[role]),
  ].filter(Boolean)
}
