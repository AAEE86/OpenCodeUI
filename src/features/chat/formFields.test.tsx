import { fireEvent, render, screen } from '@testing-library/react'
import { act, renderHook } from '@testing-library/react'
import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { FormFieldInput, useFormState, type FormState } from './formFields'
import type { ApiFormField, ApiFormInfo } from '../../api'

/**
 * v2 表单的 custom（自由输入）回归测试。
 *
 * 官方 question 工具给每个字段都带 `custom: true`（"Type your own answer"
 * 伪选项由客户端自动追加），v1 时代的 ocui 有同款交互；迁移 v2 表单渲染层
 * 时漏掉了 custom 标记，导致带选项的提问无法自由输入（issue #178）。
 */

function makeForm(field: Record<string, unknown>): ApiFormInfo {
  return {
    id: 'frm-1',
    sessionID: 'ses-1',
    title: 'Questions',
    fields: [field as unknown as ApiFormField],
  }
}

const CHOICE_FIELD = {
  key: 'q0',
  type: 'string',
  title: 'Pick one',
  options: [
    { value: 'A', label: '选项 A' },
    { value: 'B', label: '选项 B' },
  ],
  custom: true,
  required: true,
}

function renderField(form: ApiFormInfo) {
  const ref: { current?: FormState } = {}
  function Wrapper() {
    const state = useFormState(form)
    useEffect(() => {
      ref.current = state
    })
    return <FormFieldInput field={form.fields[0]} state={state} />
  }
  render(<Wrapper />)
  return {
    getState: () => {
      if (!ref.current) throw new Error('state not captured')
      return ref.current
    },
  }
}

describe('formFields custom（自由输入）', () => {
  it('custom: true 的单选字段渲染「自己输入答案」伪选项', () => {
    renderField(makeForm(CHOICE_FIELD))
    expect(screen.getByText('选项 A')).toBeTruthy()
    expect(screen.getByText(/输入你的回答|Type your own answer/i)).toBeTruthy()
  })

  it('custom 缺省/为 false 时不渲染伪选项', () => {
    const { custom, ...noCustom } = CHOICE_FIELD
    void custom
    renderField(makeForm(noCustom))
    expect(screen.queryByText(/输入你的回答|Type your own answer/i)).toBeNull()
  })

  it('点伪选项 → 出现输入框；输入文本后 buildAnswer 用自定义答案', () => {
    const { getState } = renderField(makeForm(CHOICE_FIELD))

    fireEvent.click(screen.getByText(/输入你的回答|Type your own answer/i))
    const textarea = screen.getByPlaceholderText(/输入你的回答|Type your own answer/i)
    fireEvent.change(textarea, { target: { value: '  我自己的答案  ' } })

    expect(getState().buildAnswer()).toEqual({ q0: '我自己的答案' })
    expect(getState().canSubmit).toBe(true)
  })

  it('单选互斥：进入自由输入清空选项；点选项退出自由输入', () => {
    const { getState } = renderField(makeForm(CHOICE_FIELD))

    fireEvent.click(screen.getByText('选项 A'))
    expect(getState().buildAnswer()).toEqual({ q0: 'A' })

    // 进入自由输入 → 选项被清空
    fireEvent.click(screen.getByText(/输入你的回答|Type your own answer/i))
    expect(getState().selectedFor(getState().visibleFields[0]).size).toBe(0)

    fireEvent.change(screen.getByPlaceholderText(/输入你的回答|Type your own answer/i), { target: { value: '自定义' } })
    expect(getState().buildAnswer()).toEqual({ q0: '自定义' })

    // 点回普通选项 → 自由输入模式退出，答案回到选项
    fireEvent.click(screen.getByText('选项 B'))
    expect(getState().customOnFor(getState().visibleFields[0])).toBe(false)
    expect(getState().buildAnswer()).toEqual({ q0: 'B' })
  })

  it('多选：自定义文本追加进答案数组，不与选项互斥', () => {
    const multi = { ...CHOICE_FIELD, key: 'q0', type: 'multiselect' }
    const { getState } = renderField(makeForm(multi))

    fireEvent.click(screen.getByText('选项 A'))
    fireEvent.click(screen.getByText(/输入你的回答|Type your own answer/i))
    fireEvent.change(screen.getByPlaceholderText(/输入你的回答|Type your own answer/i), { target: { value: '额外答案' } })

    expect(getState().buildAnswer()).toEqual({ q0: ['A', '额外答案'] })
  })

  it('多选：自定义文本与已选项重复时不重复追加', () => {
    const multi = { ...CHOICE_FIELD, key: 'q0', type: 'multiselect' }
    const { getState } = renderField(makeForm(multi))

    fireEvent.click(screen.getByText('选项 A'))
    fireEvent.click(screen.getByText(/输入你的回答|Type your own answer/i))
    fireEvent.change(screen.getByPlaceholderText(/输入你的回答|Type your own answer/i), { target: { value: 'A' } })

    expect(getState().buildAnswer()).toEqual({ q0: ['A'] })
  })

  it('必填单选字段：仅靠自定义文本即可提交（canSubmit）', () => {
    const { result } = renderHook(() => useFormState(makeForm(CHOICE_FIELD)))

    expect(result.current.canSubmit).toBe(false)

    const field = makeForm(CHOICE_FIELD).fields[0]
    act(() => {
      result.current.selectCustom(field)
      result.current.setText(field, '自定义答案')
    })

    expect(result.current.canSubmit).toBe(true)
    expect(result.current.buildAnswer()).toEqual({ q0: '自定义答案' })
  })
})
