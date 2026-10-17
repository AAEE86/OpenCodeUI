import { TrashIcon, PlusIcon } from '../../../components/Icons'
import { Select, TextField } from './configEditorControls'
import { SectionShell } from './configEditorFields'
import { PERMISSION_ACTION_NAMES, PERMISSION_EFFECTS } from './configEditorMeta'
import { enumChoices, type SectionProps } from './configEditorSectionTypes'
import type { JsonRecord, Lang } from './configEditorTypes'
import { isRecord, setRoot, tx } from './configEditorUtils'

const DEFAULT_RULE: JsonRecord = { action: '*', resource: '*', effect: 'ask' }

/**
 * v2 的 `permissions` 是**有序规则集**：`[{ action, resource, effect }]`。
 *
 * 规则从上到下匹配，第一条命中的生效。`action` 是自由字符串（`read`/`edit`/
 * `shell`/`subagent`/`webfetch`…，`*` 表示全部），`resource` 是它作用的资源
 * （如 `git push *`、`anthropic/*`），`effect` 是 `allow`/`deny`/`ask`。
 */
export function PermissionEditor({ value, onChange, lang }: { value: unknown; onChange: (value: unknown) => void; lang: Lang }) {
  const rules = Array.isArray(value) ? value : []
  const setRule = (index: number, next: JsonRecord) => onChange(rules.map((rule, i) => (i === index ? next : rule)))
  const removeRule = (index: number) => onChange(rules.filter((_, i) => i !== index))
  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div data-config-field="permissions" className="space-y-3">
      {rules.length === 0 ? (
        <p className="text-[length:var(--fs-sm)] text-text-400">
          {tx('No rules yet. Rules are matched top to bottom; the first match wins.', '还没有规则。规则从上到下匹配，第一条命中的生效。', lang)}
        </p>
      ) : (
        <div className="divide-y divide-border-200/35">
          {rules.map((ruleValue, index) => {
            const rule = isRecord(ruleValue) ? ruleValue : {}
            return (
              <div key={index} className="grid min-w-0 grid-cols-1 gap-2 py-3 sm:grid-cols-[28px_minmax(0,1fr)_140px]">
                <div className="hidden pt-2 text-[length:var(--fs-xs)] tabular-nums text-text-400 sm:block">{index + 1}</div>
                <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                  <label className="min-w-0 space-y-1">
                    <span className="text-[length:var(--fs-xs)] text-text-400">action</span>
                    <Select
                      editable
                      value={rule.action}
                      options={enumChoices(PERMISSION_ACTION_NAMES)}
                      onChange={next => setRule(index, { ...rule, action: next })}
                      placeholder={tx('tool or *', '工具或 *', lang)}
                    />
                  </label>
                  <label className="min-w-0 space-y-1">
                    <span className="text-[length:var(--fs-xs)] text-text-400">resource</span>
                    <TextField
                      value={rule.resource}
                      onChange={next => setRule(index, { ...rule, resource: next })}
                      placeholder={tx('* or "git push *"', '* 或 "git push *"', lang)}
                      mono
                    />
                  </label>
                </div>
                <div className="flex min-w-0 items-end gap-1.5">
                  <label className="min-w-0 flex-1 space-y-1">
                    <span className="text-[length:var(--fs-xs)] text-text-400">effect</span>
                    <Select value={rule.effect} options={enumChoices(PERMISSION_EFFECTS)} onChange={next => setRule(index, { ...rule, effect: next })} />
                  </label>
                  <button
                    type="button"
                    aria-label={tx('Move up', '上移', lang)}
                    disabled={index === 0}
                    onClick={() => moveRule(index, -1)}
                    className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-text-400 transition-colors hover:bg-bg-200/40 hover:text-text-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={tx('Move down', '下移', lang)}
                    disabled={index === rules.length - 1}
                    onClick={() => moveRule(index, 1)}
                    className="inline-flex h-8 w-7 shrink-0 items-center justify-center rounded-md text-text-400 transition-colors hover:bg-bg-200/40 hover:text-text-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={tx('Remove rule', '删除规则', lang)}
                    onClick={() => removeRule(index)}
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-300 transition-colors hover:bg-bg-200/40 hover:text-error-100"
                  >
                    <TrashIcon size={14} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
      <button
        type="button"
        onClick={() => onChange([...rules, { ...DEFAULT_RULE }])}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border-200 px-2.5 text-[length:var(--fs-sm)] font-medium text-text-100 transition-colors hover:border-border-300"
      >
        <PlusIcon size={13} />
        {tx('Add rule', '添加规则', lang)}
      </button>
    </div>
  )
}

export function PermissionsSection({ config, setConfig, lang }: SectionProps) {
  return (
    <SectionShell id="permissions" lang={lang}>
      <p className="mb-3 text-[length:var(--fs-xs)] leading-relaxed text-text-300">
        {tx(
          'Ordered rules matched top to bottom. allow = run without asking, deny = block, ask = prompt every time.',
          '按顺序从上到下匹配的规则。allow = 直接放行，deny = 拒绝，ask = 每次询问。',
          lang,
        )}
      </p>
      <PermissionEditor
        value={(config as JsonRecord).permissions}
        onChange={v => setConfig(setRoot(config, 'permissions', v))}
        lang={lang}
      />
    </SectionShell>
  )
}
