import { useTranslation } from 'react-i18next'
import type { Config } from '../../../types/api/config'
import type { JsonRecord, Lang } from './configEditorTypes'

export function tx(en: string, zh: string, lang: Lang): string {
  return lang.startsWith('zh') ? zh : en
}

export function useLang(): Lang {
  const { i18n } = useTranslation('settings')
  return i18n.language
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function hasOwn(value: unknown, key: string): boolean {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key)
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T
}

export function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

export function getObject(source: unknown, key: string): JsonRecord {
  const value = isRecord(source) ? source[key] : undefined
  return isRecord(value) ? value : {}
}

export function hasRoot(config: Config, key: string) {
  return hasOwn(config, key)
}

export function hasNested(config: Config, path: string[]) {
  let current: unknown = config
  for (const key of path) {
    if (!isRecord(current) || !hasOwn(current, key)) return false
    current = current[key]
  }
  return true
}

export function setRoot(config: Config, key: string, value: unknown): Config {
  return { ...(config as JsonRecord), [key]: value } as Config
}

/** 删除一个顶层键（用于「未设置」的可选字段，避免留下 undefined）。 */
export function unsetRoot(config: Config, key: string): Config {
  const next = { ...(config as JsonRecord) }
  delete next[key]
  return next as Config
}

export function setNested(config: Config, path: string[], value: unknown): Config {
  const next = clone(config) as JsonRecord
  let current = next
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!hasOwn(current, key) || !isRecord(current[key])) setOwn(current, key, {})
    current = current[key] as JsonRecord
  }
  setOwn(current, path[path.length - 1], value)
  return next as Config
}

function setOwn(record: JsonRecord, key: string, value: unknown) {
  Object.defineProperty(record, key, { value, enumerable: true, configurable: true, writable: true })
}

export function createMergePatch(before: unknown, after: unknown): JsonRecord {
  const previous = isRecord(before) ? before : {}
  const next = isRecord(after) ? after : {}
  const patch: JsonRecord = {}
  for (const [key, value] of Object.entries(next)) {
    if (!hasOwn(previous, key)) {
      setOwn(patch, key, clone(value))
      continue
    }
    const oldValue = previous[key]
    if (isRecord(oldValue) && isRecord(value)) {
      const child = createMergePatch(oldValue, value)
      if (Object.keys(child).length > 0) setOwn(patch, key, child)
    } else if (!sameValue(oldValue, value)) {
      setOwn(patch, key, clone(value))
    }
  }
  return patch
}

export function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/**
 * 把 v2 的 `Config.ModelSelection` 归一成 `provider/model#variant` 文本。
 *
 * 该字段允许两种形态：短串 `"provider/model#variant"` 与显式对象
 * `{ providerID, model, variant? }`。`config.get()` 返回的是**归一后的显式对象**，
 * 而 UI 里统一用短串展示。
 */
export function modelSelectionText(value: unknown): string {
  if (typeof value === 'string') return value
  if (isRecord(value)) {
    const providerID = typeof value.providerID === 'string' ? value.providerID : ''
    const model = typeof value.model === 'string' ? value.model : ''
    const variant = typeof value.variant === 'string' && value.variant ? `#${value.variant}` : ''
    if (providerID && model) return `${providerID}/${model}${variant}`
    return model || providerID
  }
  return ''
}

/** 判断一个模型选择值是否为空（避免写入非法的空串）。 */
export function isModelSelectionEmpty(value: unknown): boolean {
  return modelSelectionText(value).trim() === ''
}

export function previewValue(value: unknown, lang: Lang): string {
  if (value === undefined || value === null) return tx('not set', '未设置', lang)
  if (typeof value === 'string') return value || tx('(empty)', '（空）', lang)
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return String(value)
  if (Array.isArray(value)) return tx(`${value.length} item(s)`, `${value.length} 项`, lang)
  if (isRecord(value)) {
    const n = Object.keys(value).length
    return tx(`${n} field(s)`, `${n} 个字段`, lang)
  }
  return String(value)
}

export function suggestCopyId(id: string, existing: JsonRecord) {
  const copyMatch = id.match(/^(.*)-copy(?:-\d+)?$/)
  const base = copyMatch ? `${copyMatch[1]}-copy` : `${id}-copy`
  if (!hasOwn(existing, base)) return base
  for (let i = 2; i < 1000; i++) {
    const next = `${base}-${i}`
    if (!hasOwn(existing, next)) return next
  }
  return `${base}-${Date.now()}`
}
