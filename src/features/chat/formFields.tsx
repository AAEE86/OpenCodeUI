// ============================================
// Form 字段渲染与作答状态（OpenCode v2）
//
// v1 的「问题」只有一种交互（给若干选项 + 可选自定义输入），
// v2 的表单有 6 种字段类型：
//   string（可带 options）/ number / integer / boolean / multiselect / external
//
// 因此把「状态 + 字段渲染」抽到一处，供内联卡片（InlineQuestion）与
// 弹窗（QuestionDialog）共用，避免同一套逻辑写两遍、也保证两处视觉一致。
//
// 答案形状也随之改变：
//   v1: string[][]        —— 每个问题一个位置数组
//   v2: { [key]: FormValue } —— 按字段 key 索引的键值对象
// ============================================

import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckIcon, ExternalLinkIcon } from '../../components/Icons'
import type { ApiFormField, ApiFormInfo, FormAnswer } from '../../api'
import { isChoiceField } from '../../api'

/** 字段是否可见（v2 的 when 条件：全部满足才显示） */
export function isFieldVisible(field: ApiFormField, answer: FormAnswer): boolean {
  const when = (field as { when?: Array<{ key: string; op: 'eq' | 'neq'; value: unknown }> }).when
  if (!when || when.length === 0) return true
  return when.every(cond => {
    const current = answer[cond.key]
    const equal = Array.isArray(current) ? current.includes(String(cond.value)) : current === cond.value
    return cond.op === 'eq' ? equal : !equal
  })
}

/** 字段是否必填 */
export function isFieldRequired(field: ApiFormField): boolean {
  return (field as { required?: boolean }).required === true
}

/**
 * 字段是否允许自由输入（v2 的 `custom: true`）。
 *
 * 官方 question 工具给每个字段都带 `custom: true`——工具说明里明确写了
 * 「"Type your own answer" option is added automatically」，即带选项的
 * 单选/多选也必须允许用户自己输入答案。v1 时代的 ocui 有同款交互
 * （伪选项 + 文本框），迁移 v2 表单渲染层时漏掉了这个标记。
 */
export function allowsCustom(field: ApiFormField): boolean {
  return (field as { custom?: boolean }).custom === true
}

export interface FormState {
  /** 当前可见字段（已过滤 hidden 与未满足的 when） */
  visibleFields: ApiFormField[]
  selectedFor: (field: ApiFormField) => Set<string>
  textFor: (field: ApiFormField) => string
  booleanFor: (field: ApiFormField) => boolean
  /** 自由输入模式是否开启（custom 伪选项被选中） */
  customOnFor: (field: ApiFormField) => boolean
  selectOption: (field: ApiFormField, value: string) => void
  /** 选中「自己输入答案」伪选项：单选清空已选项，多选只是展开输入框 */
  selectCustom: (field: ApiFormField) => void
  setText: (field: ApiFormField, value: string) => void
  toggleBoolean: (field: ApiFormField) => void
  /** 是否所有必填项都已作答 */
  canSubmit: boolean
  /** 构造 v2 的键值答案 */
  buildAnswer: () => FormAnswer
}

/**
 * 表单作答状态。
 *
 * 单值字段（字符串单选 / 多选）共用 selections，按字段 key 索引；
 * 文本与数字共用 textValues；布尔单独一份。
 */
export function useFormState(form: ApiFormInfo): FormState {
  const [selections, setSelections] = useState<Map<string, Set<string>>>(() => {
    const map = new Map<string, Set<string>>()
    for (const field of form.fields) {
      const preset = (field as { default?: unknown }).default
      if (Array.isArray(preset)) map.set(field.key, new Set(preset.map(String)))
      else if (typeof preset === 'string' && isChoiceField(field)) map.set(field.key, new Set([preset]))
      else map.set(field.key, new Set())
    }
    return map
  })

  const [textValues, setTextValues] = useState<Map<string, string>>(() => {
    const map = new Map<string, string>()
    for (const field of form.fields) {
      const preset = (field as { default?: unknown }).default
      map.set(field.key, typeof preset === 'string' || typeof preset === 'number' ? String(preset) : '')
    }
    return map
  })

  const [booleans, setBooleans] = useState<Map<string, boolean>>(() => {
    const map = new Map<string, boolean>()
    for (const field of form.fields) {
      map.set(field.key, (field as { default?: unknown }).default === true)
    }
    return map
  })

  // 自由输入模式（custom 伪选项选中态），按字段 key 索引
  const [customOn, setCustomOn] = useState<Map<string, boolean>>(new Map())

  /** 供 when 求值用的当前答案（与 buildAnswer 同规则：自定义文本优先生效） */
  const customTextFor = useCallback(
    (field: ApiFormField) => (textValues.get(field.key) ?? '').trim(),
    [textValues],
  )
  const stringValueFor = useCallback(
    (field: ApiFormField): string => {
      const customText = customTextFor(field)
      if (customOn.get(field.key) && customText) return customText
      return Array.from(selections.get(field.key) ?? [])[0] ?? customText
    },
    [selections, customOn, customTextFor],
  )
  const multiValueFor = useCallback(
    (field: ApiFormField): string[] => {
      const list = Array.from(selections.get(field.key) ?? [])
      const customText = customTextFor(field)
      if (allowsCustom(field) && customText && !list.includes(customText)) list.push(customText)
      return list
    },
    [selections, customTextFor],
  )

  const currentAnswer = useMemo<FormAnswer>(() => {
    const answer: FormAnswer = {}
    for (const field of form.fields) {
      if (field.type === 'multiselect') {
        answer[field.key] = multiValueFor(field)
      } else if (field.type === 'string') {
        answer[field.key] = stringValueFor(field)
      } else if (field.type === 'boolean') {
        answer[field.key] = booleans.get(field.key) ?? false
      } else if (field.type === 'number' || field.type === 'integer') {
        const raw = textValues.get(field.key) ?? ''
        answer[field.key] = raw === '' ? '' : Number(raw)
      }
    }
    return answer
  }, [form.fields, textValues, booleans, multiValueFor, stringValueFor])

  const visibleFields = useMemo(
    () => form.fields.filter(field => !(field as { hidden?: boolean }).hidden && isFieldVisible(field, currentAnswer)),
    [form.fields, currentAnswer],
  )

  const selectOption = useCallback((field: ApiFormField, value: string) => {
    const multiple = field.type === 'multiselect'
    setSelections(prev => {
      const next = new Map(prev)
      if (multiple) {
        const set = new Set(prev.get(field.key) ?? [])
        if (set.has(value)) set.delete(value)
        else set.add(value)
        next.set(field.key, set)
      } else {
        next.set(field.key, new Set([value]))
      }
      return next
    })
    // 单选：点了普通选项就退出自由输入模式（二者互斥，与官方/v1 一致）
    if (!multiple) {
      setCustomOn(prev => {
        if (!prev.get(field.key)) return prev
        const next = new Map(prev)
        next.set(field.key, false)
        return next
      })
    }
  }, [])

  const selectCustom = useCallback((field: ApiFormField) => {
    setCustomOn(prev => {
      const next = new Map(prev)
      next.set(field.key, true)
      return next
    })
    // 单选：进入自由输入模式就清空已选选项（互斥）
    if (field.type !== 'multiselect') {
      setSelections(prev => {
        const next = new Map(prev)
        next.set(field.key, new Set())
        return next
      })
    }
  }, [])

  const setText = useCallback((field: ApiFormField, value: string) => {
    setTextValues(prev => {
      const next = new Map(prev)
      next.set(field.key, value)
      return next
    })
  }, [])

  const toggleBoolean = useCallback((field: ApiFormField) => {
    setBooleans(prev => {
      const next = new Map(prev)
      next.set(field.key, !prev.get(field.key))
      return next
    })
  }, [])

  const buildAnswer = useCallback((): FormAnswer => {
    const answer: FormAnswer = {}
    for (const field of form.fields) {
      if (field.type === 'external') continue
      if (field.type === 'multiselect') {
        answer[field.key] = multiValueFor(field)
      } else if (field.type === 'boolean') {
        answer[field.key] = booleans.get(field.key) ?? false
      } else if (field.type === 'number' || field.type === 'integer') {
        const raw = (textValues.get(field.key) ?? '').trim()
        if (raw !== '') answer[field.key] = Number(raw)
      } else if (field.type === 'string') {
        const raw = stringValueFor(field).trim()
        if (raw) answer[field.key] = raw
      }
    }
    return answer
  }, [form.fields, textValues, booleans, multiValueFor, stringValueFor])

  const canSubmit = useMemo(
    () =>
      visibleFields.every(field => {
        if (!isFieldRequired(field)) return true
        if (field.type === 'external' || field.type === 'boolean') return true
        if (field.type === 'multiselect') return multiValueFor(field).length > 0
        if (field.type === 'string' && isChoiceField(field)) {
          // 带选项的单选：选了选项，或（允许 custom 时）填了自由文本都算作答
          return (selections.get(field.key)?.size ?? 0) > 0 || (allowsCustom(field) && customTextFor(field) !== '')
        }
        return (textValues.get(field.key) ?? '').trim().length > 0
      }),
    [visibleFields, selections, textValues, multiValueFor, customTextFor],
  )

  return {
    visibleFields,
    selectedFor: field => selections.get(field.key) ?? EMPTY_SET,
    textFor: field => textValues.get(field.key) ?? '',
    booleanFor: field => booleans.get(field.key) ?? false,
    customOnFor: field => customOn.get(field.key) ?? false,
    selectOption,
    selectCustom,
    setText,
    toggleBoolean,
    canSubmit,
    buildAnswer,
  }
}

const EMPTY_SET: Set<string> = new Set()

/** 字段标题（title + 必填标记 + description） */
export function FormFieldLabel({ field }: { field: ApiFormField }) {
  const required = isFieldRequired(field)
  if (!field.title && !field.description && !required) return null
  // header 与问题文本相同时只显示一次（官方 question = description ?? title 同款）
  const mainText = field.description ?? field.title
  const showHeader = !!field.title && !!field.description && field.title !== field.description
  return (
    <div>
      {showHeader && (
        <div className="text-[length:var(--fs-xs)] text-text-400 font-medium mb-0.5">{field.title}</div>
      )}
      {mainText && (
        <div className="text-[length:var(--fs-md)] text-text-100">
          {mainText}
          {required && <span className="text-danger-100 ml-0.5">*</span>}
        </div>
      )}
    </div>
  )
}

interface FormFieldInputProps {
  field: ApiFormField
  state: FormState
}

/** 自动增高的单行文本输入（无选项字符串与 custom 自由输入共用） */
function FormTextInput({
  value,
  placeholder,
  autoFocus,
  onChange,
}: {
  value: string
  placeholder?: string
  autoFocus?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="flex min-h-7 items-start gap-1.5 rounded-md border border-border-200/60 px-2.5 py-1 transition-colors focus-within:border-text-400">
      <textarea
        value={value}
        autoFocus={autoFocus}
        onChange={e => {
          onChange(e.target.value)
          const el = e.target
          el.style.height = 'auto'
          el.style.height = `${Math.min(el.scrollHeight, 100)}px`
        }}
        placeholder={placeholder}
        rows={1}
        className="min-h-5 flex-1 resize-none bg-transparent py-0 text-[length:var(--fs-sm)] leading-5 text-text-100 placeholder:text-text-500 focus:outline-none"
      />
    </div>
  )
}

/** 按字段类型渲染对应输入控件 */
export function FormFieldInput({ field, state }: FormFieldInputProps) {
  const { t } = useTranslation('chat')

  // external：无法作答，只给跳转
  if (field.type === 'external') {
    return (
      <div className="space-y-2">
        <FormFieldLabel field={field} />
        <a
          href={field.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[length:var(--fs-sm)] text-accent-main-100 hover:underline"
        >
          <ExternalLinkIcon size={14} />
          {field.url}
        </a>
      </div>
    )
  }

  // 布尔
  if (field.type === 'boolean') {
    const checked = state.booleanFor(field)
    return (
      <div className="space-y-2">
        <FormFieldLabel field={field} />
        <button
          onClick={() => state.toggleBoolean(field)}
          className={`inline-flex min-h-7 items-start gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 rounded-md border transition-all ${
            checked
              ? 'border-text-100 text-text-100 bg-bg-300/40'
              : 'border-border-200/60 text-text-300 hover:border-text-400 hover:text-text-200'
          }`}
        >
          <span className="inline-flex h-5 w-3.5 shrink-0 items-center justify-center">
            <span
              className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                checked ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
              }`}
            >
              {checked && <CheckIcon size={10} className="shrink-0" />}
            </span>
          </span>
          <span className="min-w-0 whitespace-normal break-words text-left">{field.title || field.key}</span>
        </button>
      </div>
    )
  }

  // 数字 / 整数
  if (field.type === 'number' || field.type === 'integer') {
    return (
      <div className="space-y-2">
        <FormFieldLabel field={field} />
        <input
          type="number"
          value={state.textFor(field)}
          step={field.type === 'integer' ? 1 : 'any'}
          min={typeof field.minimum === 'number' ? field.minimum : undefined}
          max={typeof field.maximum === 'number' ? field.maximum : undefined}
          onChange={e => state.setText(field, e.target.value)}
          className="w-full rounded-md border border-border-200/60 bg-transparent px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 text-text-100 placeholder:text-text-500 focus:border-text-400 focus:outline-none"
        />
      </div>
    )
  }

  // 多选 / 带选项的字符串单选
  if (field.type === 'multiselect' || (field.type === 'string' && isChoiceField(field))) {
    const multiple = field.type === 'multiselect'
    const options = field.type === 'multiselect' ? field.options : (field.options ?? [])
    const selected = state.selectedFor(field)
    // custom: true → 追加「自己输入答案」伪选项（官方 question 工具的行为约定）
    const customAllowed = allowsCustom(field)
    const customOn = state.customOnFor(field)
    return (
      <div className="space-y-2">
        <FormFieldLabel field={field} />
        <div className="flex flex-wrap gap-1.5">
          {options.map(option => {
            const isSelected = selected.has(option.value)
            return (
              <button
                key={option.value}
                onClick={() => state.selectOption(field, option.value)}
                title={option.description}
                className={`inline-flex min-h-7 items-start gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 rounded-md border transition-all ${
                  isSelected
                    ? 'border-text-100 text-text-100 bg-bg-300/40'
                    : 'border-border-200/60 text-text-300 hover:border-text-400 hover:text-text-200'
                }`}
              >
                {multiple && (
                  <span className="inline-flex h-5 w-3.5 shrink-0 items-center justify-center">
                    <span
                      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
                        isSelected ? 'border-text-100 bg-text-100 text-bg-000' : 'border-border-300'
                      }`}
                    >
                      {isSelected && <CheckIcon size={10} className="shrink-0" />}
                    </span>
                  </span>
                )}
                <span className="min-w-0 whitespace-normal break-words text-left">{option.label}</span>
              </button>
            )
          })}
          {customAllowed && (
            <button
              onClick={() => state.selectCustom(field)}
              className={`inline-flex min-h-7 items-start gap-1.5 px-2.5 py-1 text-[length:var(--fs-sm)] leading-5 rounded-md border transition-all ${
                customOn
                  ? 'border-text-100 text-text-100 bg-bg-300/40'
                  : 'border-dashed border-border-200/60 text-text-400 hover:border-text-400 hover:text-text-200'
              }`}
            >
              <span className="min-w-0 whitespace-normal break-words text-left">
                {t('questionDialog.typeYourAnswer')}
              </span>
            </button>
          )}
        </div>
        {customAllowed && customOn && (
          <FormTextInput
            value={state.textFor(field)}
            autoFocus
            placeholder={t('questionDialog.typeYourAnswer')}
            onChange={value => state.setText(field, value)}
          />
        )}
      </div>
    )
  }

  // 无选项的字符串：文本输入
  const placeholder = field.type === 'string' ? field.placeholder : undefined
  return (
    <div className="space-y-2">
      <FormFieldLabel field={field} />
      <FormTextInput
        value={state.textFor(field)}
        placeholder={placeholder || t('questionDialog.typeYourAnswer')}
        onChange={value => state.setText(field, value)}
      />
    </div>
  )
}
