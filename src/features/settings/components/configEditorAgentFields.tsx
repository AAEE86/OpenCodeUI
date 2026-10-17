import { BoolField, KeyValueField, PositiveIntegerField, Select, StringMapField, TextArea, TextField } from './configEditorControls'
import { DrillFields, type FieldDef } from './configEditorFields'
import { PermissionEditor } from './configEditorPermissions'
import { enumChoices } from './configEditorSectionTypes'
import type { Choice, JsonRecord, Lang } from './configEditorTypes'
import { isRecord, modelSelectionText, previewValue, tx } from './configEditorUtils'

/**
 * v2 的 agent 字段（对应 `ConfigAgent.Info`）。
 *
 * 相比 v1：`prompt`→`system`、`disable`→`disabled`、`maxSteps`→`steps`，
 * `temperature`/`top_p` 等采样参数进 `request.body`，`tools` 与
 * `permission` 合并成有序规则集 `permissions`，`variant` 并入 `model` 选择。
 */
export function buildAgentConfigFields({
  value,
  onChange,
  lang,
  models,
}: {
  value: JsonRecord
  onChange: (next: JsonRecord) => void
  lang: Lang
  models: Choice[]
}): FieldDef[] {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v })
  const unset = (key: string) => {
    const next = { ...value }
    delete next[key]
    onChange(next)
  }
  return [
    {
      key: 'model',
      label: 'model',
      desc: tx('Model used by this agent, in provider/model format (append #variant to pin a variant).', '该 agent 使用的模型，格式 provider/model（可在末尾加 #variant 固定变体）。', lang),
      control: (
        <Select
          editable
          value={modelSelectionText(value.model)}
          options={models}
          onChange={v => (v.trim() ? set('model', v) : unset('model'))}
          placeholder="provider/model"
        />
      ),
    },
    { key: 'description', label: 'description', desc: tx('Description of when to use the agent.', '何时使用该 agent 的说明。', lang), control: <TextField value={value.description} onChange={v => set('description', v)} /> },
    { key: 'mode', label: 'mode', desc: tx("Agent mode: 'primary', 'subagent' or 'all'.", "agent 模式：primary、subagent 或 all。", lang), control: <Select value={value.mode} options={enumChoices(['primary', 'subagent', 'all'])} onChange={v => set('mode', v)} /> },
    { key: 'color', label: 'color', desc: tx('Hex color (#RRGGBB).', '十六进制颜色（#RRGGBB）。', lang), control: <TextField value={value.color} onChange={v => set('color', v)} placeholder="#RRGGBB" mono /> },
    { key: 'steps', label: 'steps', desc: tx('Max agentic iterations before forcing a text-only response.', '强制结束前的最大迭代步数。', lang), control: <PositiveIntegerField value={value.steps} onChange={v => set('steps', v)} /> },
    { key: 'hidden', label: 'hidden', desc: tx('Hide this subagent from the @ autocomplete menu.', '在 @ 自动补全菜单中隐藏该子 agent。', lang), control: <BoolField value={value.hidden} onChange={v => set('hidden', v)} /> },
    { key: 'disabled', label: 'disabled', desc: tx('Disable this agent entirely.', '完全禁用该 agent。', lang), control: <BoolField value={value.disabled} onChange={v => set('disabled', v)} /> },
    { key: 'system', label: 'system', block: true, desc: tx('System prompt override for this agent.', '该 agent 的系统提示词覆盖。', lang), control: <TextArea value={value.system} onChange={v => set('system', v)} /> },
    {
      key: 'request',
      label: 'request',
      desc: tx('Extra HTTP headers and request body fields sent for this agent.', '该 agent 请求附带的 HTTP 头和请求体字段。', lang),
      drill: {
        title: 'request',
        preview: previewValue(value.request, lang),
        render: () => <AgentRequestEditor value={value.request} onChange={v => set('request', v)} lang={lang} />,
      },
    },
    {
      key: 'permissions',
      label: 'permissions',
      desc: tx('Per-agent ordered permission rules (overrides global).', '该 agent 的有序权限规则（覆盖全局）。', lang),
      drill: {
        title: 'permissions',
        preview: previewValue(value.permissions, lang),
        render: () => <PermissionEditor value={value.permissions} onChange={v => set('permissions', v)} lang={lang} />,
      },
    },
  ]
}

function AgentRequestEditor({ value, onChange, lang }: { value: unknown; onChange: (value: unknown) => void; lang: Lang }) {
  const request = isRecord(value) ? value : {}
  const set = (key: string, v: unknown) => onChange({ ...request, [key]: v })
  const fields: FieldDef[] = [
    {
      key: 'headers',
      label: 'headers',
      desc: tx('Extra HTTP headers sent with this agent\'s requests.', '该 agent 请求附带的 HTTP 头。', lang),
      drill: { title: 'headers', preview: previewValue(request.headers, lang), render: () => <StringMapField value={request.headers} onChange={v => set('headers', v)} /> },
    },
    {
      key: 'body',
      label: 'body',
      desc: tx('Extra request body fields (sampling options etc.).', '额外的请求体字段（采样参数等）。', lang),
      drill: { title: 'body', preview: previewValue(request.body, lang), render: () => <KeyValueField value={request.body} onChange={v => set('body', v)} /> },
    },
  ]
  return <DrillFields fields={fields} isConfigured={key => key in request} lang={lang} />
}
