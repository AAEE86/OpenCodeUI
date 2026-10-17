import { useState } from 'react'
import { ChevronRightIcon, PlusIcon, TrashIcon } from '../../../components/Icons'
import { DrillChild } from './configEditorDrill'
import { useDrillContainer, useDrillState } from './configEditorDrillState'
import { BoolField, fieldClass, IntegerField, KeyValueField, NumberField, NumberOrFalseField, Select, StringListField, StringMapField, TextField } from './configEditorControls'
import { DrillFields, DuplicateIdField, EmptyHint, FieldRow, GroupHeader, SectionShell, type FieldDef } from './configEditorFields'
import { MODALITIES } from './configEditorMeta'
import { enumChoices, type SectionProps } from './configEditorSectionTypes'
import type { JsonRecord, Lang } from './configEditorTypes'
import { asStringArray, clone, getObject, hasOwn, isRecord, previewValue, setNested, tx } from './configEditorUtils'

export function ProvidersSection({ config, setConfig, lang, providerCatalog }: SectionProps) {
  return (
    <SectionShell id="providers" lang={lang}>
      <ProvidersHome config={config} setConfig={setConfig} lang={lang} providerCatalog={providerCatalog} />
    </SectionShell>
  )
}

type ProviderViewProps = Pick<SectionProps, 'config' | 'setConfig' | 'lang' | 'providerCatalog'>

function ProvidersHome({ config, setConfig, lang, providerCatalog }: ProviderViewProps) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const providerMap = getObject(config, 'providers')
  const configured = Object.keys(providerMap).sort()
  const available = Object.keys(providerCatalog).filter(id => !hasOwn(providerMap, id)).sort()
  const [newProvider, setNewProvider] = useState('')
  const [availQuery, setAvailQuery] = useState('')

  const openProvider = (id: string) => enter({ id: `provider:${id}`, title: id })

  const addProvider = (id: string) => {
    if (!id || hasOwn(providerMap, id)) return
    setConfig(setNested(config, ['providers', id], {}))
    openProvider(id)
  }

  if (activeChildId?.startsWith('provider:')) {
    const id = activeChildId.slice('provider:'.length)
    return (
      <DrillChild depth={depth}>
        <ProviderDetail config={config} setConfig={setConfig} lang={lang} providerCatalog={providerCatalog} providerId={id} />
      </DrillChild>
    )
  }

  return (
    <div className="space-y-8">
      <section>
        <GroupHeader text={tx('Configured', '已配置', lang)} count={configured.length} accent />
        {configured.length === 0 ? (
          <EmptyHint text={tx('No custom providers. Add one below or pick from Available.', '没有自定义渠道。可在下方添加，或从可配置里选。', lang)} />
        ) : (
          <div className="divide-y divide-border-200/35">
            {configured.map(id => {
              const pv = getObject(providerMap, id)
              const modelCount = Object.keys(getObject(pv, 'models')).length
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => openProvider(id)}
                  className="group grid w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 py-3 text-left"
                >
                  <span className="min-w-0 truncate text-[length:var(--fs-sm)] font-medium text-text-100">{id}</span>
                  <span className="shrink-0 truncate text-[length:var(--fs-xs)] text-text-400">
                    {modelCount > 0
                      ? tx(`${modelCount} model override(s)`, `${modelCount} 个模型覆盖`, lang)
                      : tx('provider config', '渠道配置', lang)}
                  </span>
                  <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
                </button>
              )
            })}
          </div>
        )}
        <div className="mt-3 flex min-w-0 items-center gap-2">
          <input
            value={newProvider}
            onChange={event => setNewProvider(event.target.value)}
            placeholder={tx('custom provider id', '自定义渠道 id', lang)}
            onKeyDown={event => {
              if (event.key === 'Enter' && newProvider.trim() && !hasOwn(providerMap, newProvider.trim())) {
                addProvider(newProvider.trim())
                setNewProvider('')
              }
            }}
            className={`${fieldClass} min-w-0 flex-1 font-mono`}
          />
          <button
            type="button"
            disabled={!newProvider.trim() || hasOwn(providerMap, newProvider.trim())}
            onClick={() => {
              addProvider(newProvider.trim())
              setNewProvider('')
            }}
            className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border-200 px-2.5 text-[length:var(--fs-sm)] font-medium text-text-100 transition-colors hover:border-border-300 disabled:opacity-40"
          >
            <PlusIcon size={14} />
            {tx('Add', '添加', lang)}
          </button>
        </div>
      </section>

      <section>
        <GroupHeader text={tx('Available', '可配置', lang)} count={available.length} />
        <input
          value={availQuery}
          onChange={event => setAvailQuery(event.target.value)}
          placeholder={tx('search providers…', '搜索渠道…', lang)}
          className={`${fieldClass} mb-2`}
        />
        <div className="max-h-72 divide-y divide-border-200/25 overflow-y-auto custom-scrollbar">
          {available
            .filter(id => !availQuery || id.toLowerCase().includes(availQuery.toLowerCase()))
            .slice(0, 80)
            .map(id => {
              const meta = getObject(providerCatalog, id)
              const name = typeof meta.name === 'string' ? meta.name : ''
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => addProvider(id)}
                  className="flex w-full items-center justify-between gap-3 py-2.5 text-left"
                >
                  <span className="min-w-0 flex-1 truncate text-[length:var(--fs-sm)] text-text-200">
                    {name || id}
                    {name && name !== id && <span className="ml-2 font-mono text-[length:var(--fs-xs)] text-text-400">{id}</span>}
                  </span>
                  <PlusIcon size={14} className="shrink-0 text-text-300" />
                </button>
              )
            })}
        </div>
      </section>
    </div>
  )
}

function ProviderDetail({
  config,
  setConfig,
  lang,
  providerCatalog,
  providerId,
}: ProviderViewProps & { providerId: string }) {
  const { activeChildId } = useDrillContainer()
  const drill = useDrillState()
  const providerMap = getObject(config, 'providers')
  const providerValue = getObject(providerMap, providerId)
  const setProvider = (next: JsonRecord) => setConfig(setNested(config, ['providers', providerId], next))
  const configuredModels = getObject(providerValue, 'models')

  const fields: FieldDef[] = [
    { key: 'name', label: 'name', desc: tx('Display name for this provider.', '此渠道的显示名称。', lang), control: <TextField value={providerValue.name} onChange={v => setProvider({ ...providerValue, name: v })} /> },
    { key: 'canonical', label: 'canonical', desc: tx('Canonical provider id this one maps onto.', '该渠道映射到的规范 provider id。', lang), control: <TextField value={providerValue.canonical} onChange={v => setProvider({ ...providerValue, canonical: v })} mono /> },
    { key: 'package', label: 'package', desc: tx('Package implementing the AI SDK provider (e.g. @ai-sdk/openai-compatible).', '实现该 AI SDK provider 的包（如 @ai-sdk/openai-compatible）。', lang), control: <TextField value={providerValue.package} onChange={v => setProvider({ ...providerValue, package: v })} mono /> },
    { key: 'env', label: 'env', desc: tx('Environment variables that hold the API key.', '存放 API key 的环境变量名。', lang), control: <StringListField value={providerValue.env} onChange={v => setProvider({ ...providerValue, env: v })} mono /> },
    {
      key: 'settings',
      label: 'settings',
      desc: tx('Connection settings (timeouts, transport, compaction).', '连接设置（超时、传输方式、压缩）。', lang),
      drill: { title: 'settings', preview: previewValue(providerValue.settings, lang), render: () => <ProviderSettingsEditor value={providerValue.settings} onChange={v => setProvider({ ...providerValue, settings: v })} lang={lang} /> },
    },
    { key: 'headers', label: 'headers', desc: tx('Extra HTTP headers sent to the provider.', '发送给渠道的额外 HTTP 请求头。', lang), drill: { title: 'headers', preview: previewValue(providerValue.headers, lang), render: () => <StringMapField value={providerValue.headers} onChange={v => setProvider({ ...providerValue, headers: v })} /> } },
    { key: 'body', label: 'body', desc: tx('Extra fields merged into every request body.', '合并进每个请求体的额外字段。', lang), drill: { title: 'body', preview: previewValue(providerValue.body, lang), render: () => <KeyValueField value={providerValue.body} onChange={v => setProvider({ ...providerValue, body: v })} /> } },
    {
      key: 'models',
      label: 'models',
      desc: tx(`${Object.keys(configuredModels).length} model override(s) configured.`, `已配置 ${Object.keys(configuredModels).length} 个模型覆盖。`, lang),
      drill: { title: 'models', preview: previewValue(configuredModels, lang), render: () => <ProviderModels config={config} setConfig={setConfig} lang={lang} providerCatalog={providerCatalog} providerId={providerId} /> },
    },
  ]

  return (
    <div className="space-y-6">
      {!activeChildId && (
        <DuplicateIdField
          sourceId={providerId}
          existing={{ ...providerCatalog, ...providerMap }}
          lang={lang}
          onCopy={targetId => {
            setConfig(setNested(config, ['providers', targetId], clone(providerValue)))
            drill.replace(0, { id: `provider:${targetId}`, title: targetId })
          }}
        />
      )}
      <DrillFields fields={fields} isConfigured={key => key in providerValue} lang={lang} />
    </div>
  )
}

function ProviderSettingsEditor({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const rec = isRecord(value) ? value : {}
  const known = ['timeout', 'headerTimeout', 'chunkTimeout', 'compaction', 'transport']
  const compaction = getObject(rec, 'compaction')
  const fields: FieldDef[] = [
    { key: 'timeout', label: 'timeout', desc: tx('Request timeout in ms. Set false to disable.', '整个请求的超时（毫秒）。设为 false 可禁用。', lang), control: <NumberOrFalseField value={rec.timeout} onChange={v => onChange({ ...rec, timeout: v })} /> },
    { key: 'headerTimeout', label: 'headerTimeout', desc: tx('Timeout in ms waiting for response headers. Set false to disable.', '等待响应头的超时（毫秒）。设为 false 可禁用。', lang), control: <NumberOrFalseField value={rec.headerTimeout} onChange={v => onChange({ ...rec, headerTimeout: v })} /> },
    { key: 'chunkTimeout', label: 'chunkTimeout', desc: tx('Timeout in ms between streamed SSE chunks. Set false to disable.', 'SSE 流式分块之间的超时（毫秒）。设为 false 可禁用。', lang), control: <NumberOrFalseField value={rec.chunkTimeout} onChange={v => onChange({ ...rec, chunkTimeout: v })} /> },
    { key: 'compaction', label: 'compaction', desc: tx("Compaction strategy: 'summary' or 'native'.", "压缩策略：summary 或 native。", lang), control: <Select value={compaction.type} options={enumChoices(['summary', 'native'])} onChange={v => onChange({ ...rec, compaction: { type: v } })} /> },
    { key: 'transport', label: 'transport', desc: tx("Transport: 'http' or 'websocket'.", "传输方式：http 或 websocket。", lang), control: <Select value={rec.transport} options={enumChoices(['http', 'websocket'])} onChange={v => onChange({ ...rec, transport: v })} /> },
  ]
  const extra = Object.keys(rec).filter(key => !known.includes(key))
  const knownPart = Object.fromEntries(Object.entries(rec).filter(([key]) => known.includes(key)))
  return (
    <div className="space-y-3">
      <DrillFields fields={fields} isConfigured={key => key in rec} lang={lang} />
      {extra.length > 0 && (
        <FieldRow
          label={tx('other settings', '其他设置', lang)}
          block
          control={<KeyValueField value={Object.fromEntries(extra.map(k => [k, rec[k]]))} onChange={next => onChange({ ...knownPart, ...next })} />}
        />
      )}
    </div>
  )
}

function ProviderModels({
  config,
  setConfig,
  lang,
  providerId,
}: ProviderViewProps & { providerId: string }) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const drill = useDrillState()
  const providerMap = getObject(config, 'providers')
  const providerValue = getObject(providerMap, providerId)
  const configuredModels = getObject(providerValue, 'models')
  const modelIDs = Object.keys(configuredModels).sort()
  const [newModel, setNewModel] = useState('')
  const [query, setQuery] = useState('')

  const openModel = (id: string) => enter({ id: `model:${id}`, title: id })

  const addModel = (id: string) => {
    if (!id || hasOwn(configuredModels, id)) return
    setConfig(setNested(config, ['providers', providerId, 'models', id], {}))
    openModel(id)
  }

  if (activeChildId?.startsWith('model:')) {
    const id = activeChildId.slice('model:'.length)
    const modelValue = isRecord(configuredModels[id]) ? (configuredModels[id] as JsonRecord) : {}
    const existingModels = Object.fromEntries(modelIDs.map(modelId => [modelId, true]))
    return (
      <DrillChild depth={depth}>
        <div className="space-y-6">
          {drill.stack.length === depth + 1 && (
            <DuplicateIdField
              sourceId={id}
              existing={existingModels}
              lang={lang}
              onCopy={targetId => {
                setConfig(setNested(config, ['providers', providerId, 'models', targetId], clone(modelValue)))
                drill.replace(depth, { id: `model:${targetId}`, title: targetId })
              }}
            />
          )}
          <ModelEditor
            value={modelValue}
            onChange={next => setConfig(setNested(config, ['providers', providerId, 'models', id], next))}
            lang={lang}
          />
        </div>
      </DrillChild>
    )
  }

  const filtered = modelIDs.filter(id => !query || id.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="space-y-3">
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder={tx('search models…', '搜索模型…', lang)} className={fieldClass} />
      <div className="max-h-[440px] divide-y divide-border-200/35 overflow-y-auto custom-scrollbar">
        {filtered.length === 0 && <EmptyHint text={tx('No model overrides. Add one below.', '没有模型覆盖，可在下方添加。', lang)} />}
        {filtered.map(id => (
          <button
            key={id}
            type="button"
            onClick={() => openModel(id)}
            className="group grid w-full grid-cols-[minmax(0,1fr)_14px] items-center gap-3 py-3 text-left"
          >
            <span className="min-w-0 truncate text-[length:var(--fs-sm)] font-medium text-text-100">{id}</span>
            <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
          </button>
        ))}
      </div>
      <div className="flex min-w-0 gap-2">
        <input
          value={newModel}
          onChange={event => setNewModel(event.target.value)}
          placeholder={tx('new model id', '新模型 id', lang)}
          onKeyDown={event => {
            if (event.key === 'Enter' && newModel.trim() && !hasOwn(configuredModels, newModel.trim())) {
              addModel(newModel.trim())
              setNewModel('')
            }
          }}
          className={`${fieldClass} min-w-0 flex-1 font-mono`}
        />
        <button
          type="button"
          disabled={!newModel.trim() || hasOwn(configuredModels, newModel.trim())}
          onClick={() => {
            addModel(newModel.trim())
            setNewModel('')
          }}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-[length:var(--fs-sm)] font-medium text-accent-main-100 transition-colors hover:bg-accent-main-100/10 disabled:opacity-40"
        >
          <PlusIcon size={14} />
          {tx('Add', '添加', lang)}
        </button>
      </div>
    </div>
  )
}

function ModelEditor({ value, onChange, lang }: { value: JsonRecord; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const set = (key: string, v: unknown) => onChange({ ...value, [key]: v })
  const limit = getObject(value, 'limit')
  const fields: FieldDef[] = [
    { key: 'name', label: 'name', desc: tx('Display name for the model.', '模型显示名。', lang), control: <TextField value={value.name} onChange={v => set('name', v)} /> },
    { key: 'modelID', label: 'modelID', desc: tx("Provider-native model id (when it differs from the config key).", '渠道原生模型 id（与配置 key 不同时使用）。', lang), control: <TextField value={value.modelID} onChange={v => set('modelID', v)} mono /> },
    { key: 'family', label: 'family', desc: tx('Model family/series.', '模型系列。', lang), control: <TextField value={value.family} onChange={v => set('family', v)} /> },
    { key: 'package', label: 'package', desc: tx('Per-model provider package override.', '该模型的渠道包覆盖。', lang), control: <TextField value={value.package} onChange={v => set('package', v)} mono /> },
    { key: 'disabled', label: 'disabled', desc: tx('Disable this model.', '禁用该模型。', lang), control: <BoolField value={value.disabled} onChange={v => set('disabled', v)} /> },
    { key: 'settings', label: 'settings', desc: tx('Model settings (compaction and provider-specific options).', '模型设置（压缩以及渠道专属选项）。', lang), drill: { title: 'settings', preview: previewValue(value.settings, lang), render: () => <ModelSettingsEditor value={value.settings} onChange={v => set('settings', v)} lang={lang} /> } },
    { key: 'headers', label: 'headers', desc: tx('Per-model HTTP headers.', '该模型的 HTTP 请求头。', lang), drill: { title: 'headers', preview: previewValue(value.headers, lang), render: () => <StringMapField value={value.headers} onChange={v => set('headers', v)} /> } },
    { key: 'body', label: 'body', desc: tx('Per-model request body fields.', '该模型的请求体字段。', lang), drill: { title: 'body', preview: previewValue(value.body, lang), render: () => <KeyValueField value={value.body} onChange={v => set('body', v)} /> } },
    { key: 'capabilities', label: 'capabilities', desc: tx('Tool calling and supported input/output modalities.', '工具调用能力与支持的输入/输出模态。', lang), drill: { title: 'capabilities', preview: previewValue(value.capabilities, lang), render: () => <CapabilitiesEditor value={value.capabilities} onChange={v => set('capabilities', v)} lang={lang} /> } },
    { key: 'compatibility', label: 'compatibility', desc: tx('Provider compatibility quirks (reasoning field, token field names, etc.).', '渠道兼容性细节（reasoning 字段、token 字段名等）。', lang), drill: { title: 'compatibility', preview: previewValue(value.compatibility, lang), render: () => <CompatibilityEditor value={value.compatibility} onChange={v => set('compatibility', v)} lang={lang} /> } },
    { key: 'cost', label: 'cost', desc: tx('Token costs per 1M tokens.', '每百万 token 的费用。', lang), drill: { title: 'cost', preview: previewValue(value.cost, lang), render: () => <CostEditor value={value.cost} onChange={v => set('cost', v)} lang={lang} /> } },
    {
      key: 'limit',
      label: 'limit',
      desc: tx('Context / input / output token limits.', '上下文/输入/输出 token 限制。', lang),
      drill: {
        title: 'limit',
        preview: previewValue(limit, lang),
        render: () => (
          <DrillFields
            fields={[
              { key: 'context', label: 'context', desc: tx('Total context window size.', '总上下文窗口大小。', lang), control: <IntegerField value={limit.context} min={0} onChange={v => set('limit', { ...limit, context: v })} /> },
              { key: 'input', label: 'input', desc: tx('Maximum input tokens.', '最大输入 token 数。', lang), control: <IntegerField value={limit.input} min={0} onChange={v => set('limit', { ...limit, input: v })} /> },
              { key: 'output', label: 'output', desc: tx('Maximum output tokens.', '最大输出 token 数。', lang), control: <IntegerField value={limit.output} min={0} onChange={v => set('limit', { ...limit, output: v })} /> },
            ]}
            isConfigured={key => key in limit}
            lang={lang}
          />
        ),
      },
    },
    { key: 'variants', label: 'variants', desc: tx('Named model variants (settings/headers/body overrides).', '命名模型变体（settings/headers/body 覆盖）。', lang), drill: { title: 'variants', preview: previewValue(value.variants, lang), render: () => <ModelVariantsEditor value={value.variants} onChange={v => set('variants', v)} lang={lang} /> } },
  ]
  return <DrillFields fields={fields} isConfigured={key => key in value} lang={lang} />
}

function ModelSettingsEditor({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const rec = isRecord(value) ? value : {}
  const compaction = getObject(rec, 'compaction')
  const fields: FieldDef[] = [
    { key: 'compaction', label: 'compaction', desc: tx("Compaction strategy: 'summary' or 'native'.", "压缩策略：summary 或 native。", lang), control: <Select value={compaction.type} options={enumChoices(['summary', 'native'])} onChange={v => onChange({ ...rec, compaction: { type: v } })} /> },
  ]
  const extra = Object.keys(rec).filter(key => key !== 'compaction')
  const knownPart = Object.fromEntries(Object.entries(rec).filter(([key]) => key === 'compaction'))
  return (
    <div className="space-y-3">
      <DrillFields fields={fields} isConfigured={key => key in rec} lang={lang} />
      {extra.length > 0 && (
        <FieldRow
          label={tx('other settings', '其他设置', lang)}
          block
          control={<KeyValueField value={Object.fromEntries(extra.map(k => [k, rec[k]]))} onChange={next => onChange({ ...knownPart, ...next })} />}
        />
      )}
    </div>
  )
}

function CapabilitiesEditor({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const rec = isRecord(value) ? value : {}
  const fields: FieldDef[] = [
    { key: 'tools', label: 'tools', desc: tx('Model supports tool/function calling.', '模型支持工具/函数调用。', lang), control: <BoolField value={rec.tools} onChange={v => onChange({ ...rec, tools: v })} /> },
    {
      key: 'input',
      label: 'input',
      block: true,
      desc: tx('Accepted input modalities.', '可接受的输入模态。', lang),
      control: <MultiToggle options={MODALITIES} value={asStringArray(rec.input)} onChange={v => onChange({ ...rec, input: v })} />,
    },
    {
      key: 'output',
      label: 'output',
      block: true,
      desc: tx('Produced output modalities.', '可产生的输出模态。', lang),
      control: <MultiToggle options={MODALITIES} value={asStringArray(rec.output)} onChange={v => onChange({ ...rec, output: v })} />,
    },
  ]
  return <DrillFields fields={fields} isConfigured={key => key in rec} lang={lang} />
}

function CompatibilityEditor({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const rec = isRecord(value) ? value : {}
  const set = (key: string, v: unknown) => onChange({ ...rec, [key]: v })
  const fields: FieldDef[] = [
    { key: 'reasoningField', label: 'reasoningField', desc: tx('Field name carrying reasoning content (e.g. reasoning_content).', '承载推理内容的字段名（如 reasoning_content）。', lang), control: <TextField value={rec.reasoningField} onChange={v => set('reasoningField', v)} mono /> },
    { key: 'maxTokensField', label: 'maxTokensField', desc: tx("Which max-token field the model expects: 'max_tokens' or 'max_completion_tokens'.", "模型期望的 max token 字段：max_tokens 或 max_completion_tokens。", lang), control: <Select editable value={rec.maxTokensField} options={enumChoices(['max_completion_tokens', 'max_tokens'])} onChange={v => set('maxTokensField', v)} /> },
    { key: 'requireReasoning', label: 'requireReasoning', desc: tx('Require every assistant message to include its reasoning field.', '要求每条 assistant 消息都带 reasoning 字段。', lang), control: <BoolField value={rec.requireReasoning} onChange={v => set('requireReasoning', v)} /> },
    { key: 'requireFinishReason', label: 'requireFinishReason', desc: tx('Require a finish_reason on every response.', '要求每个响应都带 finish_reason。', lang), control: <BoolField value={rec.requireFinishReason} onChange={v => set('requireFinishReason', v)} /> },
    { key: 'requireAssistantAfterTool', label: 'requireAssistantAfterTool', desc: tx('Require an assistant message after tool results.', '工具结果之后必须跟一条 assistant 消息。', lang), control: <BoolField value={rec.requireAssistantAfterTool} onChange={v => set('requireAssistantAfterTool', v)} /> },
    { key: 'supportsPromptCacheKey', label: 'supportsPromptCacheKey', desc: tx('Provider supports promptCacheKey.', '渠道支持 promptCacheKey。', lang), control: <BoolField value={rec.supportsPromptCacheKey} onChange={v => set('supportsPromptCacheKey', v)} /> },
    { key: 'supportsThinkingBlockBinding', label: 'supportsThinkingBlockBinding', desc: tx('Supports Anthropic thinking-prefix mismatch controls.', '支持 Anthropic thinking-prefix 匹配控制。', lang), control: <BoolField value={rec.supportsThinkingBlockBinding} onChange={v => set('supportsThinkingBlockBinding', v)} /> },
    { key: 'supportsEffortUpdates', label: 'supportsEffortUpdates', desc: tx('Supports per-message effort updates.', '支持逐消息的 effort 更新。', lang), control: <BoolField value={rec.supportsEffortUpdates} onChange={v => set('supportsEffortUpdates', v)} /> },
  ]
  return <DrillFields fields={fields} isConfigured={key => key in rec} lang={lang} />
}

function CostEditor({ value, onChange, lang }: { value: unknown; onChange: (value: unknown) => void; lang: Lang }) {
  const isArray = Array.isArray(value)
  const entries: unknown[] = isArray ? value : [isRecord(value) ? value : {}]
  const commit = (next: unknown[]) => onChange(isArray ? next : next[0] ?? {})
  const setEntry = (index: number, entry: JsonRecord) => commit(entries.map((item, i) => (i === index ? entry : item)))

  return (
    <div className="space-y-3">
      <FieldRow
        label={tx('shape', '形态', lang)}
        desc={tx('A single cost entry, or a tiered list of entries.', '单条费用，或按 tier 分层的多条费用。', lang)}
        control={
          <Select
            value={isArray ? 'array' : 'single'}
            options={[
              { value: 'single', label: tx('single cost', '单条费用', lang) },
              { value: 'array', label: tx('tiered list', '分层列表', lang) },
            ]}
            onChange={next => onChange(next === 'array' ? entries : entries[0] ?? {})}
          />
        }
      />
      {entries.map((entryValue, index) => {
        const entry = isRecord(entryValue) ? entryValue : {}
        const cache = getObject(entry, 'cache')
        const tier = getObject(entry, 'tier')
        return (
          <div key={index} className="space-y-3 rounded-lg border border-border-200/40 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[length:var(--fs-xs)] font-medium text-text-300">{isArray ? tx(`entry ${index + 1}`, `第 ${index + 1} 条`, lang) : 'cost'}</span>
              {isArray && entries.length > 1 && (
                <button
                  type="button"
                  aria-label={tx('Remove cost entry', '删除费用条目', lang)}
                  onClick={() => commit(entries.filter((_, i) => i !== index))}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-300 transition-colors hover:bg-bg-200/40 hover:text-error-100"
                >
                  <TrashIcon size={13} />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-[length:var(--fs-xs)] text-text-500">
                input
                <NumberField value={entry.input} onChange={v => setEntry(index, { ...entry, input: v })} />
              </label>
              <label className="text-[length:var(--fs-xs)] text-text-500">
                output
                <NumberField value={entry.output} onChange={v => setEntry(index, { ...entry, output: v })} />
              </label>
              <label className="text-[length:var(--fs-xs)] text-text-500">
                cache.read
                <NumberField value={cache.read} onChange={v => setEntry(index, { ...entry, cache: { ...cache, read: v } })} />
              </label>
              <label className="text-[length:var(--fs-xs)] text-text-500">
                cache.write
                <NumberField value={cache.write} onChange={v => setEntry(index, { ...entry, cache: { ...cache, write: v } })} />
              </label>
              <label className="text-[length:var(--fs-xs)] text-text-500">
                tier.size (context)
                <IntegerField value={tier.size} min={0} onChange={v => setEntry(index, { ...entry, tier: { type: 'context', size: v } })} />
              </label>
            </div>
          </div>
        )
      })}
      {isArray && (
        <button
          type="button"
          onClick={() => onChange([...entries, {}])}
          className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border-200 px-2.5 text-[length:var(--fs-sm)] font-medium text-text-100 transition-colors hover:border-border-300"
        >
          <PlusIcon size={13} />
          {tx('Add cost entry', '添加费用条目', lang)}
        </button>
      )}
      <div className="text-[length:var(--fs-xs)] leading-relaxed text-text-400">
        {tx('input and output are required; cache and tier are optional.', 'input 与 output 必填；cache 与 tier 可选。', lang)}
      </div>
    </div>
  )
}

function ModelVariantsEditor({ value, onChange, lang }: { value: unknown; onChange: (value: unknown[]) => void; lang: Lang }) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const list = Array.isArray(value) ? value : []
  const [newName, setNewName] = useState('')

  if (activeChildId?.startsWith('variant:')) {
    const index = Number(activeChildId.slice('variant:'.length))
    const variant = isRecord(list[index]) ? (list[index] as JsonRecord) : {}
    const setVariant = (next: JsonRecord) => onChange(list.map((item, i) => (i === index ? next : item)))
    const set = (key: string, v: unknown) => setVariant({ ...variant, [key]: v })
    const fields: FieldDef[] = [
      { key: 'id', label: 'id', desc: tx('Variant identifier.', '变体标识。', lang), control: <TextField value={variant.id} onChange={v => set('id', v)} mono /> },
      { key: 'settings', label: 'settings', desc: tx('Variant settings overrides.', '变体的 settings 覆盖。', lang), drill: { title: 'settings', preview: previewValue(variant.settings, lang), render: () => <ModelSettingsEditor value={variant.settings} onChange={v => set('settings', v)} lang={lang} /> } },
      { key: 'headers', label: 'headers', desc: tx('Variant HTTP headers.', '变体的 HTTP 请求头。', lang), drill: { title: 'headers', preview: previewValue(variant.headers, lang), render: () => <StringMapField value={variant.headers} onChange={v => set('headers', v)} /> } },
      { key: 'body', label: 'body', desc: tx('Variant request body fields.', '变体的请求体字段。', lang), drill: { title: 'body', preview: previewValue(variant.body, lang), render: () => <KeyValueField value={variant.body} onChange={v => set('body', v)} /> } },
    ]
    return (
      <DrillChild depth={depth}>
        <DrillFields fields={fields} isConfigured={key => key in variant} lang={lang} />
      </DrillChild>
    )
  }

  const addVariant = () => {
    const name = newName.trim()
    if (!name || list.some(item => isRecord(item) && item.id === name)) return
    onChange([...list, { id: name }])
    setNewName('')
  }

  return (
    <div className="space-y-3">
      {list.length === 0 ? (
        <EmptyHint text={tx('No variants configured.', '还没有配置变体。', lang)} />
      ) : (
        <div className="divide-y divide-border-200/35">
          {list.map((item, index) => {
            const variant = isRecord(item) ? item : {}
            const title = typeof variant.id === 'string' && variant.id ? variant.id : String(index)
            return (
              <button
                key={index}
                type="button"
                onClick={() => enter({ id: `variant:${index}`, title })}
                className="group grid w-full grid-cols-[minmax(0,1fr)_auto_14px] items-center gap-3 py-3 text-left"
              >
                <span className="min-w-0 truncate text-[length:var(--fs-sm)] font-medium text-text-100">{title}</span>
                <span className="shrink-0 truncate text-[length:var(--fs-xs)] text-text-400">{previewValue(item, lang)}</span>
                <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
              </button>
            )
          })}
        </div>
      )}
      <div className="flex min-w-0 gap-2">
        <input
          value={newName}
          onChange={event => setNewName(event.target.value)}
          placeholder={tx('variant id', '变体 id', lang)}
          onKeyDown={event => {
            if (event.key === 'Enter') addVariant()
          }}
          className={`${fieldClass} min-w-0 flex-1 font-mono`}
        />
        <button
          type="button"
          disabled={!newName.trim()}
          onClick={addVariant}
          className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-border-200 px-2.5 text-[length:var(--fs-sm)] font-medium text-text-100 transition-colors hover:border-border-300 disabled:opacity-40"
        >
          <PlusIcon size={13} />
          {tx('Add', '添加', lang)}
        </button>
      </div>
    </div>
  )
}

function MultiToggle({ options, value, onChange }: { options: string[]; value: string[]; onChange: (value: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5 pt-1">
      {options.map(option => {
        const active = value.includes(option)
        return (
          <button
            key={option}
            type="button"
            onClick={() => onChange(active ? value.filter(v => v !== option) : [...value, option])}
            className={`rounded-md border px-2.5 py-1 text-[length:var(--fs-xs)] transition-all duration-150 ${
              active
                ? 'border-accent-main-100/20 bg-accent-main-100/10 text-accent-main-100 font-medium'
                : 'border-border-200/60 text-text-400 hover:bg-bg-100/50 hover:text-text-200'
            }`}
          >
            {option}
          </button>
        )
      })}
    </div>
  )
}
