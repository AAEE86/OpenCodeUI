import type { SearchMenuItem } from '../settingsSearchCatalog'
import type { DrillEntry } from './configEditorDrillState'
import { KNOWN_ROOT_KEYS, SECTION_IDS, SECTION_META } from './configEditorMeta'
import type { JsonRecord, Lang, SectionID } from './configEditorTypes'
import { isRecord, tx } from './configEditorUtils'

export interface ConfigEditorSearchItem extends SearchMenuItem {
  section: SectionID
  segments: string[]
  stack: DrillEntry[]
  fieldKey?: string
  source: 'section' | 'field' | 'json'
}

const SENSITIVE_KEY =
  /(?:api.?key|access.?key|private.?key|auth|cookie|credential|pass(?:word)?|secret|session.?key|token)/i
const SENSITIVE_CONTAINER = /^(?:headers?|environment|env)$/i

/**
 * v2 里「已知但可能还没配置」的字段路径。
 *
 * 只列叶子字段；有值的字段由 JSON 遍历自动索引，两者按落点去重。
 */
const KNOWN_FIELD_PATHS: string[][] = [
  ['$schema'],
  ['model'],
  ['default_agent'],
  ['shell'],
  ['username'],
  ['update'],
  ['share'],
  ['snapshots'],
  ['instructions'],
  ['enterprise', 'url'],
  ['commands'],
  ['skills'],
  ['references'],
  ['plugins'],
  ['providers'],
  ['agents'],
  ['mcp'],
  ['permissions'],
  ['formatter'],
  ['lsp'],
  ['media', 'image', 'auto_resize'],
  ['media', 'image', 'max_width'],
  ['media', 'image', 'max_height'],
  ['media', 'image', 'max_base64_bytes'],
  ['tool_output', 'max_lines'],
  ['tool_output', 'max_bytes'],
  ['compaction', 'auto'],
  ['compaction', 'keep', 'tokens'],
  ['compaction', 'buffer'],
  ['watcher', 'ignore'],
  ['websearch'],
  ['worktree', 'directory'],
  ['warming'],
  ['experimental', 'portable_shell_scanner'],
  ['experimental', 'subagent_depth'],
  ['experimental', 'policies'],
]

const PROVIDER_DRILLS = new Set(['settings', 'headers', 'body'])
const MODEL_DRILLS = new Set(['settings', 'headers', 'body', 'capabilities', 'cost', 'limit', 'compatibility'])
const MCP_DRILLS = new Set(['environment', 'headers', 'oauth', 'timeout'])
const RUNTIME_LEAF_KEYS = new Set(['tool_output', 'compaction', 'watcher', 'worktree'])

export function sectionForConfigSegments(segments: string[]): SectionID {
  const root = segments[0]
  if (root === 'commands') return 'commands'
  if (root === 'skills' || root === 'references') return 'skills'
  if (root === 'plugins') return 'plugins'
  if (root === 'providers') return 'providers'
  if (root === 'agents') return 'agents'
  if (root === 'mcp') return 'mcp'
  if (root === 'permissions') return 'permissions'
  if (root === 'formatter') return 'formatters'
  if (root === 'lsp') return 'lsp'
  if (root === 'media') return 'media'
  if (RUNTIME_LEAF_KEYS.has(root ?? '') || root === 'websearch' || root === 'warming') return 'runtime'
  if (root === 'experimental') return 'experimental'
  if (root && !KNOWN_ROOT_KEYS.has(root)) return 'advanced'
  return 'general'
}

export function navigationForConfigSegments(segments: string[]) {
  const section = sectionForConfigSegments(segments)
  const stack: DrillEntry[] = []
  const push = (id: string | undefined, title?: string) => {
    if (id) stack.push({ id, title: title ?? id })
  }
  let fieldKey: string | undefined
  const [root, id, third, fourth, fifth, sixth, seventh] = segments

  if (root === 'commands') {
    push(id ? `command:${id}` : undefined, id)
    if (third === 'model') fieldKey = 'model'
    else fieldKey = third
  } else if (root === 'references') {
    push(id ? `reference:${id}` : undefined, id ? `@${id}` : undefined)
    fieldKey = third
  } else if (root === 'skills') {
    fieldKey = 'skills'
  } else if (root === 'plugins') {
    push(id ? `plugin:${id}` : undefined, 'plugin')
    if (third === 'options') {
      push('options', 'options')
      fieldKey = 'options'
    } else fieldKey = 'package'
  } else if (root === 'providers') {
    push(id ? `provider:${id}` : undefined, id)
    if (third === 'models') {
      push('models', 'models')
      push(fourth ? `model:${fourth}` : undefined, fourth)
      if (fifth === 'variants') {
        push('variants', 'variants')
        push(sixth ? `variant:${sixth}` : undefined, sixth)
        if (seventh && MODEL_DRILLS.has(seventh)) push(seventh, seventh)
        fieldKey = seventh ?? 'variants'
      } else if (fifth && fifth !== 'id' && (MODEL_DRILLS.has(fifth) || fifth === 'cost')) {
        push(fifth, fifth)
        fieldKey = fifth
      } else fieldKey = fifth
    } else if (third && PROVIDER_DRILLS.has(third)) {
      push(third, third)
      fieldKey = third
    } else fieldKey = third
  } else if (root === 'agents') {
    push(id ? `agent:${id}` : undefined, id)
    if (third === 'model') fieldKey = 'model'
    else if (third === 'request') {
      push('request', 'request')
      if (fourth === 'headers' || fourth === 'body') {
        push(fourth, fourth)
        fieldKey = fourth
      } else fieldKey = 'request'
    } else if (third === 'permissions') {
      push('permissions', 'permissions')
      fieldKey = 'permissions'
    } else fieldKey = third
  } else if (root === 'mcp') {
    if (id === 'timeout') {
      push('timeout', 'timeout')
      fieldKey = third ? third : 'timeout'
    } else if (id === 'servers') {
      push(third ? `mcp:${third}` : undefined, third)
      if (fourth && MCP_DRILLS.has(fourth)) {
        push(fourth, fourth)
        fieldKey = fifth ?? fourth
      } else fieldKey = fourth
    } else {
      push(id ? `mcp:${id}` : undefined, id)
      if (third && MCP_DRILLS.has(third)) {
        push(third, third)
        fieldKey = fourth ?? third
      } else fieldKey = third
    }
  } else if (root === 'formatter') {
    push(id ? `formatter:${id}` : undefined, id)
    if (third === 'environment') push('environment', 'environment')
    fieldKey = third
  } else if (root === 'lsp') {
    push(id ? `lsp:${id}` : undefined, id)
    if (third === 'env' || third === 'initialization') push(third, third)
    fieldKey = third
  } else if (root === 'media') {
    fieldKey = segments[2]
  } else if (root === 'permissions') {
    fieldKey = 'permissions'
  } else if (RUNTIME_LEAF_KEYS.has(root ?? '')) {
    fieldKey = segments.join('.')
  } else if (root === 'websearch' || root === 'warming') {
    fieldKey = root
  } else if (root === 'experimental') {
    fieldKey = id
  } else if (section === 'general') {
    fieldKey = root === 'model' ? 'model' : segments.join('.')
  } else {
    fieldKey = root
  }

  return { section, stack, fieldKey }
}

function formatConfigPath(segments: string[]) {
  return segments.reduce((path, segment, index) => {
    if (/^\d+$/.test(segment)) return `${path}[${segment}]`
    if (/^[A-Za-z_$][\w$]*$/.test(segment)) return index === 0 ? segment : `${path}.${segment}`
    return `${path}[${JSON.stringify(segment)}]`
  }, '')
}

function previewJsonValue(value: unknown, segments: string[], lang: Lang) {
  if (isSensitivePath(segments)) return tx('[sensitive value hidden]', '[敏感值已隐藏]', lang)
  if (Array.isArray(value)) return tx(`[${value.length} items]`, `[${value.length} 项]`, lang)
  if (isRecord(value)) return tx(`{${Object.keys(value).length} keys}`, `{${Object.keys(value).length} 个字段}`, lang)
  const serialized = JSON.stringify(value)
  if (serialized === undefined) return String(value)
  return serialized.length > 120 ? `${serialized.slice(0, 117)}...` : serialized
}

function isSensitivePath(segments: string[]) {
  return segments.some(segment => SENSITIVE_KEY.test(segment) || SENSITIVE_CONTAINER.test(segment))
}

function searchableJsonValue(value: unknown, segments: string[]) {
  if (isSensitivePath(segments)) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return JSON.stringify(value)
  if (Array.isArray(value) && value.every(item => !isRecord(item) && !Array.isArray(item))) return JSON.stringify(value)
  return ''
}

export function buildConfigEditorSearchItems(config: JsonRecord, lang: Lang): ConfigEditorSearchItem[] {
  const sectionItems = SECTION_IDS.map(section => {
    const meta = SECTION_META[section]
    return {
      id: `section:${section}`,
      label: tx(meta.en, meta.zh, lang),
      description: tx(meta.descEn, meta.descZh, lang),
      tabLabel: tx('Section', '分区', lang),
      section,
      segments: [],
      stack: [],
      source: 'section' as const,
    }
  })
  const itemsByDestination = new Map<string, ConfigEditorSearchItem>()
  const searchTermsByDestination = new Map<string, string[]>()
  const pending: { value: unknown; segments: string[]; parent?: unknown }[] = [{ value: config, segments: [] }]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current) break
    const { value, segments, parent } = current
    if (segments.length > 0) {
      const navigation = navigationForConfigSegments(segments)
      // 引用值是纯字符串时，编辑器用 'value' 承载它。
      if (segments[0] === 'references' && segments.length === 2 && typeof value === 'string') {
        navigation.fieldKey = 'value'
      }
      // LSP 的 disabled-only 形态（{ disabled: true }，无 command）由 mode 选择器承载。
      if (
        segments[0] === 'lsp' &&
        segments[2] === 'disabled' &&
        isRecord(parent) &&
        parent.disabled === true &&
        !('command' in parent)
      ) {
        navigation.fieldKey = 'mode'
      }
      const destination = JSON.stringify([
        navigation.section,
        navigation.stack.map(entry => entry.id),
        navigation.fieldKey ?? '',
      ])
      const path = formatConfigPath(segments)
      const searchValue = searchableJsonValue(value, segments)
      const existing = itemsByDestination.get(destination)
      if (existing) {
        searchTermsByDestination.get(destination)?.push(path, searchValue)
      } else {
        itemsByDestination.set(destination, {
          id: `json:${JSON.stringify(segments)}`,
          label: path,
          description: previewJsonValue(value, segments, lang),
          tabLabel: tx(SECTION_META[navigation.section].en, SECTION_META[navigation.section].zh, lang),
          section: navigation.section,
          segments,
          stack: navigation.stack,
          fieldKey: navigation.fieldKey,
          source: 'json',
        })
        searchTermsByDestination.set(destination, [searchValue])
      }
    }

    if (Array.isArray(value)) {
      if (value.every(item => !isRecord(item) && !Array.isArray(item))) continue
      for (let index = value.length - 1; index >= 0; index -= 1) {
        pending.push({ value: value[index], segments: [...segments, String(index)], parent: value })
      }
    } else if (isRecord(value)) {
      const entries = Object.entries(value)
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const [key, child] = entries[index]
        pending.push({ value: child, segments: [...segments, key], parent: value })
      }
    }
  }

  const configuredItems = Array.from(itemsByDestination.entries()).map(([destination, item]) => ({
    ...item,
    searchText: searchTermsByDestination.get(destination)?.filter(Boolean).join(' '),
  }))
  const configuredDestinations = new Set(
    configuredItems.map(item => JSON.stringify([item.section, item.stack.map(entry => entry.id), item.fieldKey ?? ''])),
  )
  const availableItems = KNOWN_FIELD_PATHS.flatMap(segments => {
    const navigation = navigationForConfigSegments(segments)
    const destination = JSON.stringify([
      navigation.section,
      navigation.stack.map(entry => entry.id),
      navigation.fieldKey ?? '',
    ])
    if (configuredDestinations.has(destination)) return []
    const path = formatConfigPath(segments)
    return [
      {
        id: `field:${path}`,
        label: path,
        description: tx('Available field', '可配置字段', lang),
        tabLabel: tx(SECTION_META[navigation.section].en, SECTION_META[navigation.section].zh, lang),
        section: navigation.section,
        segments,
        stack: navigation.stack,
        fieldKey: navigation.fieldKey,
        source: 'field' as const,
      },
    ]
  })

  return [...sectionItems, ...configuredItems, ...availableItems]
}
