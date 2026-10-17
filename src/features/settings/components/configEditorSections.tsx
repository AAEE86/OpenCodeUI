import { useState } from 'react'
import { ChevronRightIcon, PlusIcon, TrashIcon } from '../../../components/Icons'
import { AgentsSection } from './configEditorAgents'
import { DrillChild } from './configEditorDrill'
import { useDrillContainer, useDrillState } from './configEditorDrillState'
import { BoolField, fieldClass, IntegerField, JsonStructuredEditor, KeyValueField, NumberField, PositiveIntegerField, Select, StringListField, TextArea, TextField } from './configEditorControls'
import { DrillFields, DuplicateIdField, EmptyHint, FieldRow, GroupHeader, NamedDrillList, SectionShell, type FieldDef } from './configEditorFields'
import { FormatterSection, LspSection, McpSection } from './configEditorIntegrations'
import { KNOWN_ROOT_KEYS, POLICY_ACTIONS, POLICY_EFFECTS } from './configEditorMeta'
import { PermissionsSection } from './configEditorPermissions'
import { ProvidersSection } from './configEditorProviders'
import { enumChoices, type SectionProps } from './configEditorSectionTypes'
import type { JsonRecord, Lang, SectionID } from './configEditorTypes'
import { clone, getObject, hasNested, hasOwn, hasRoot, isRecord, modelSelectionText, previewValue, setNested, setRoot, unsetRoot, tx } from './configEditorUtils'

/** 复制一份对象并删掉某个键，用于「未设置」的可选字段。 */
function omitKey(record: JsonRecord, key: string): JsonRecord {
  const next = { ...record }
  delete next[key]
  return next
}

function GeneralSection({ config, setConfig, lang, shells, models, agents }: SectionProps) {
  const root = config as JsonRecord
  const set = (key: string, value: unknown) => setConfig(setRoot(config, key, value))
  const enterprise = getObject(config, 'enterprise')
  const fields: FieldDef[] = [
    {
      key: '$schema',
      label: '$schema',
      desc: tx('JSON schema reference used by editors and validators.', '供编辑器与校验工具使用的 JSON schema 引用。', lang),
      control: <TextField value={root.$schema} onChange={v => set('$schema', v)} mono />,
    },
    {
      key: 'model',
      label: 'model',
      desc: tx('Default model, in provider/model format (append #variant to pin one).', '默认模型，格式 provider/model（末尾可加 #variant）。', lang),
      control: <Select editable value={modelSelectionText(root.model)} options={models} onChange={v => (v.trim() ? set('model', v) : setConfig(unsetRoot(config, 'model')))} placeholder="provider/model" />,
    },
    {
      key: 'default_agent',
      label: 'default_agent',
      desc: tx('Default primary agent used when a session does not pick one.', '会话未指定时使用的默认主 agent。', lang),
      control: <Select editable value={root.default_agent} options={agents} onChange={v => (v.trim() ? set('default_agent', v) : setConfig(unsetRoot(config, 'default_agent')))} />,
    },
    {
      key: 'shell',
      label: 'shell',
      desc: tx('Default shell for the terminal and shell tool.', '终端和 shell 工具默认使用的 shell。', lang),
      control: <Select editable value={root.shell} options={shells} onChange={v => (v.trim() ? set('shell', v) : setConfig(unsetRoot(config, 'shell')))} />,
    },
    {
      key: 'username',
      label: 'username',
      desc: tx('Username shown in conversations and used for telemetry identity.', '对话中显示的用户名，也用于遥测身份。', lang),
      control: <TextField value={root.username} onChange={v => set('username', v)} />,
    },
    {
      key: 'update',
      label: 'update',
      desc: tx("Update behavior: 'disable', 'notify', or 'auto'.", "更新行为：disable 关闭、notify 仅提示、auto 自动更新。", lang),
      control: <Select value={root.update} options={enumChoices(['disable', 'notify', 'auto'])} onChange={v => set('update', v)} />,
    },
    {
      key: 'share',
      label: 'share',
      desc: tx("Sharing: 'manual', 'auto', or 'disabled'.", "分享：manual 手动、auto 自动、disabled 禁用。", lang),
      control: <Select value={root.share} options={enumChoices(['manual', 'auto', 'disabled'])} onChange={v => set('share', v)} />,
    },
    {
      key: 'snapshots',
      label: 'snapshots',
      desc: tx('Record filesystem snapshots so changes can be undone or reverted (default: true).', '记录文件系统快照以支持撤销/回退（默认 true）。', lang),
      control: <BoolField value={root.snapshots !== false} onChange={v => set('snapshots', v)} />,
    },
    {
      key: 'instructions',
      label: 'instructions',
      block: true,
      desc: tx('Extra instruction files or glob patterns to load.', '额外加载的 instruction 文件或通配符。', lang),
      control: <StringListField value={root.instructions} onChange={v => set('instructions', v)} mono placeholder="AGENTS.md" />,
    },
    {
      key: 'enterprise.url',
      label: 'enterprise.url',
      desc: tx('Enterprise sharing service URL.', '企业分享服务的 URL。', lang),
      control: <TextField value={enterprise.url} onChange={v => setConfig(setNested(config, ['enterprise', 'url'], v))} mono />,
    },
  ]
  return (
    <SectionShell id="general" lang={lang}>
      <DrillFields
        fields={fields}
        isConfigured={key => (key === 'enterprise.url' ? hasNested(config, ['enterprise', 'url']) : hasRoot(config, key))}
        lang={lang}
      />
    </SectionShell>
  )
}

function CommandsSection(props: SectionProps) {
  return (
    <SectionShell id="commands" lang={props.lang}>
      <CommandHome {...props} />
    </SectionShell>
  )
}

function CommandHome({ config, setConfig, lang, models, agents }: SectionProps) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const drill = useDrillState()
  const map = getObject(config, 'commands')
  const names = Object.keys(map).sort()
  const selected = activeChildId?.startsWith('command:') ? activeChildId.slice('command:'.length) : ''
  const value = getObject(config, 'commands')[selected]
  const item = isRecord(value) ? value : {}
  const setItem = (next: JsonRecord) => setConfig(setNested(config, ['commands', selected], next))
  const fields: FieldDef[] = selected
    ? [
        { key: 'template', label: 'template', badge: tx('required', '必填', lang), block: true, desc: tx('Prompt template sent when the command runs. Use $ARGUMENTS for input.', '命令运行时发送的 prompt 模板，可用 $ARGUMENTS 接收输入。', lang), control: <TextArea value={item.template} onChange={v => setItem({ ...item, template: v })} /> },
        { key: 'description', label: 'description', desc: tx('Short description shown in the command menu.', '命令菜单中显示的简短描述。', lang), control: <TextField value={item.description} onChange={v => setItem({ ...item, description: v })} /> },
        { key: 'agent', label: 'agent', desc: tx('Agent used to run this command.', '运行此命令使用的 agent。', lang), control: <Select editable value={item.agent} options={agents} onChange={v => setItem(v.trim() ? { ...item, agent: v } : omitKey(item, 'agent'))} /> },
        { key: 'model', label: 'model', desc: tx('Model override, in provider/model format.', '模型覆盖，格式 provider/model。', lang), control: <Select editable value={modelSelectionText(item.model)} options={models} onChange={v => setItem(v.trim() ? { ...item, model: v } : omitKey(item, 'model'))} placeholder="provider/model" /> },
        { key: 'subagent', label: 'subagent', desc: tx('Run this command inside a subagent.', '在子 agent 中运行该命令。', lang), control: <BoolField value={item.subagent} onChange={v => setItem({ ...item, subagent: v })} /> },
        { key: 'subtask', label: 'subtask', badge: tx('deprecated', '已废弃', lang), desc: tx('Deprecated alias of subagent.', 'subagent 的废弃别名。', lang), control: <BoolField value={item.subtask} onChange={v => setItem({ ...item, subtask: v })} /> },
      ]
    : []
  if (selected) {
    return (
      <DrillChild depth={depth}>
        <div className="space-y-6">
          <DuplicateIdField
            sourceId={selected}
            existing={map}
            lang={lang}
            onCopy={targetId => {
              setConfig(setNested(config, ['commands', targetId], clone(item)))
              drill.replace(0, { id: `command:${targetId}`, title: targetId })
            }}
          />
          <DrillFields fields={fields} isConfigured={key => key in item} lang={lang} />
        </div>
      </DrillChild>
    )
  }

  return (
    <NamedDrillList
      lang={lang}
      items={names}
      addPlaceholder={tx('command name', '命令名', lang)}
      onOpen={name => enter({ id: `command:${name}`, title: name })}
      onAdd={name => setConfig(setNested(config, ['commands', name], { template: '' }))}
      renderPreview={name => (isRecord(map[name]) ? String((map[name] as JsonRecord).description ?? '') : '')}
      emptyText={tx('Add a command, then configure its template.', '先添加命令，再配置它的 template。', lang)}
    />
  )
}

function SkillsSection({ config, setConfig, lang }: SectionProps) {
  return (
    <SectionShell id="skills" lang={lang}>
      <SkillsContent config={config} setConfig={setConfig} lang={lang} />
    </SectionShell>
  )
}

function SkillsContent({ config, setConfig, lang }: Pick<SectionProps, 'config' | 'setConfig' | 'lang'>) {
  const { activeChildId } = useDrillContainer()
  const references = getObject(config, 'references')
  const editingReference = Boolean(activeChildId?.startsWith('reference:'))
  const skillFields: FieldDef[] = [
    {
      key: 'skills',
      label: 'skills',
      block: true,
      desc: tx('Additional paths or URLs to discover skills from.', '额外发现技能的路径或 URL。', lang),
      control: <StringListField value={(config as JsonRecord).skills} onChange={v => setConfig(setRoot(config, 'skills', v))} mono placeholder="./skills" />,
    },
  ]
  return (
    <div className="space-y-6">
      {!editingReference && <DrillFields fields={skillFields} isConfigured={() => hasRoot(config, 'skills')} lang={lang} />}
      {!editingReference && (
        <div>
          <GroupHeader text={tx('References (@alias)', '引用（@alias）', lang)} count={Object.keys(references).length} />
          <p className="mb-2 text-[length:var(--fs-xs)] leading-relaxed text-text-400">
            {tx('Named git repositories or local directories mentioned as @alias or @alias/path.', '命名的 git 仓库或本地目录，可用 @alias 或 @alias/path 提及。', lang)}
          </p>
          <ReferenceEditor value={references} onChange={v => setConfig(setRoot(config, 'references', v))} lang={lang} />
        </div>
      )}
    </div>
  )
}

function ReferenceEditor({ value, onChange, lang }: { value: JsonRecord; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const drill = useDrillState()
  const [newAlias, setNewAlias] = useState('')
  const entries = Object.entries(value)
  const setEntry = (alias: string, entry: unknown) => onChange({ ...value, [alias]: entry })
  const typeOf = (entry: unknown): 'string' | 'git' | 'local' => {
    if (typeof entry === 'string') return 'string'
    if (isRecord(entry) && 'path' in entry) return 'local'
    return 'git'
  }

  if (activeChildId?.startsWith('reference:')) {
    const alias = activeChildId.slice('reference:'.length)
    if (hasOwn(value, alias)) {
      return (
        <DrillChild depth={depth}>
          <div className="space-y-6">
            <DuplicateIdField
              sourceId={alias}
              existing={value}
              lang={lang}
              onCopy={targetId => {
                onChange({ ...value, [targetId]: clone(value[alias]) })
                drill.replace(depth, { id: `reference:${targetId}`, title: `@${targetId}` })
              }}
            />
            <ReferenceEntry alias={alias} entry={value[alias]} setEntry={setEntry} lang={lang} />
          </div>
        </DrillChild>
      )
    }
  }

  return (
    <div className="space-y-3">
      {entries.length === 0 && <EmptyHint text={tx('No references configured.', '还没有配置引用。', lang)} />}
      <div className="space-y-0.5">
      {entries.map(([alias, entry]) => {
        const type = typeOf(entry)
        return (
          <div key={alias} className="group flex items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-bg-100/50">
            <button type="button" onClick={() => enter({ id: `reference:${alias}`, title: `@${alias}` })} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[length:var(--fs-sm)] font-medium text-text-100">@{alias}</div>
                <div className="truncate text-[length:var(--fs-xs)] text-text-400">{type} · {previewValue(entry, lang)}</div>
              </div>
              <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
            </button>
            <button type="button" aria-label={tx(`Remove reference ${alias}`, `删除引用 ${alias}`, lang)} onClick={() => onChange(omitKey(value, alias))} className="shrink-0 rounded-md p-1.5 text-text-400 opacity-0 transition-opacity hover:text-error-100 group-hover:opacity-100">
              <TrashIcon size={13} />
            </button>
          </div>
        )
      })}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input value={newAlias} onChange={event => setNewAlias(event.target.value)} placeholder={tx('alias', '别名', lang)} className={`${fieldClass} min-w-0 flex-1 font-mono`} />
        <button
          type="button"
          disabled={!newAlias.trim() || hasOwn(value, newAlias.trim())}
          onClick={() => {
            setEntry(newAlias.trim(), '')
            setNewAlias('')
          }}
          className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-border-200/60 px-3 py-2 text-[length:var(--fs-xs)] text-text-300 hover:bg-bg-100 disabled:opacity-40"
        >
          <PlusIcon size={13} />
          {tx('Add reference', '添加引用', lang)}
        </button>
      </div>
    </div>
  )
}

function ReferenceEntry({ alias, entry, setEntry, lang }: { alias: string; entry: unknown; setEntry: (alias: string, entry: unknown) => void; lang: Lang }) {
  const type = typeof entry === 'string' ? 'string' : isRecord(entry) && 'path' in entry ? 'local' : 'git'
  const rec = isRecord(entry) ? entry : {}
  const fields: FieldDef[] = [
    {
      key: 'type',
      label: 'type',
      desc: tx('Reference source type.', '引用来源类型。', lang),
      control: (
        <Select
          value={type}
          options={[
            { value: 'string', label: tx('string (path/url)', 'string（路径/URL）', lang) },
            { value: 'git', label: tx('git repository', 'git 仓库', lang) },
            { value: 'local', label: tx('local path', '本地路径', lang) },
          ]}
          onChange={next => {
            if (next === 'string') setEntry(alias, '')
            else if (next === 'git') setEntry(alias, { repository: '' })
            else setEntry(alias, { path: '' })
          }}
        />
      ),
    },
    ...(type === 'string'
      ? [{ key: 'value', label: 'value', desc: tx('Path, URL, or owner/repo shorthand.', '路径、URL 或 owner/repo 简写。', lang), control: <TextField value={typeof entry === 'string' ? entry : ''} onChange={v => setEntry(alias, v)} mono placeholder="owner/repo or path" /> }]
      : type === 'git'
        ? [
            { key: 'repository', label: 'repository', desc: tx('Repository URL or owner/repo shorthand.', '仓库 URL 或 owner/repo 简写。', lang), control: <TextField value={rec.repository} onChange={v => setEntry(alias, { ...rec, repository: v })} mono placeholder={tx('repository URL or owner/repo', '仓库 URL 或 owner/repo', lang)} /> },
            { key: 'branch', label: 'branch', desc: tx('Branch to use (optional).', '使用的分支（可选）。', lang), control: <TextField value={rec.branch} onChange={v => setEntry(alias, { ...rec, branch: v })} /> },
            { key: 'description', label: 'description', desc: tx('Description of this reference.', '该引用的说明。', lang), control: <TextField value={rec.description} onChange={v => setEntry(alias, { ...rec, description: v })} /> },
            { key: 'hidden', label: 'hidden', desc: tx('Hide this reference from suggestions.', '在建议列表中隐藏该引用。', lang), control: <BoolField value={rec.hidden} onChange={v => setEntry(alias, { ...rec, hidden: v })} /> },
          ]
        : [
            { key: 'path', label: 'path', desc: tx('Local path to reference.', '本地引用路径。', lang), control: <TextField value={rec.path} onChange={v => setEntry(alias, { ...rec, path: v })} mono placeholder={tx('absolute, ~/ or workspace-relative path', '绝对路径、~/ 或相对工作区路径', lang)} /> },
            { key: 'description', label: 'description', desc: tx('Description of this reference.', '该引用的说明。', lang), control: <TextField value={rec.description} onChange={v => setEntry(alias, { ...rec, description: v })} /> },
            { key: 'hidden', label: 'hidden', desc: tx('Hide this reference from suggestions.', '在建议列表中隐藏该引用。', lang), control: <BoolField value={rec.hidden} onChange={v => setEntry(alias, { ...rec, hidden: v })} /> },
          ]),
  ]
  return <DrillFields fields={fields} isConfigured={key => key === 'type' || (isRecord(entry) ? key in entry : key === 'value')} lang={lang} />
}

function PluginsSection(props: SectionProps) {
  return (
    <SectionShell id="plugins" lang={props.lang}>
      <PluginsHome {...props} />
    </SectionShell>
  )
}

function PluginsHome({ config, setConfig, lang }: SectionProps) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const list = Array.isArray((config as JsonRecord).plugins) ? ((config as JsonRecord).plugins as unknown[]) : []
  const set = (next: unknown[]) => setConfig(setRoot(config, 'plugins', next))

  if (activeChildId?.startsWith('plugin:')) {
    const index = Number(activeChildId.slice('plugin:'.length))
    if (Number.isInteger(index) && index >= 0 && index < list.length) {
      return (
        <DrillChild depth={depth}>
          <PluginEntry list={list} set={set} index={index} lang={lang} />
        </DrillChild>
      )
    }
  }

  return (
    <div className="space-y-3">
      {list.length === 0 ? (
        <EmptyHint text={tx('No plugins configured.', '还没有配置插件。', lang)} />
      ) : (
        <div className="space-y-0.5">
          {list.map((entry, index) => {
            const isObject = isRecord(entry)
            const name = isObject ? String(entry.package ?? '') : String(entry ?? '')
            const options = isObject && isRecord(entry.options) ? entry.options : {}
            return (
              <div key={index} className="group flex items-center gap-2 rounded-lg px-2.5 transition-colors hover:bg-bg-100/50">
                <button type="button" onClick={() => enter({ id: `plugin:${index}`, title: name || tx('plugin', '插件', lang) })} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 text-left">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[length:var(--fs-sm)] font-medium text-text-100">{name || tx('(empty)', '（空）', lang)}</div>
                    <div className="truncate text-[length:var(--fs-xs)] text-text-400">{isObject ? previewValue(options, lang) : tx('no options', '无配置项', lang)}</div>
                  </div>
                  <ChevronRightIcon size={14} className="shrink-0 text-text-300" />
                </button>
                <button type="button" aria-label={tx(`Remove plugin ${index + 1}`, `删除第 ${index + 1} 个插件`, lang)} onClick={() => set(list.filter((_, i) => i !== index))} className="shrink-0 rounded-md p-1.5 text-text-400 opacity-0 transition-opacity hover:text-error-100 group-hover:opacity-100">
                  <TrashIcon size={13} />
                </button>
              </div>
            )
          })}
        </div>
      )}
      <button type="button" onClick={() => set([...list, ''])} className="inline-flex items-center gap-1.5 rounded-lg border border-border-200/60 px-3 py-1.5 text-[length:var(--fs-xs)] text-text-300 hover:bg-bg-100">
        <PlusIcon size={13} />
        {tx('Add plugin', '添加插件', lang)}
      </button>
    </div>
  )
}

function PluginEntry({ list, set, index, lang }: { list: unknown[]; set: (next: unknown[]) => void; index: number; lang: Lang }) {
  const entry = list[index]
  const isObject = isRecord(entry)
  const name = isObject ? String(entry.package ?? '') : String(entry ?? '')
  const options = isObject && isRecord(entry.options) ? entry.options : {}
  const fields: FieldDef[] = [
    {
      key: 'package',
      label: 'package',
      desc: tx('Plugin package spec or local plugin file.', '插件包名或本地插件文件。', lang),
      control: (
        <TextField
          value={name}
          onChange={value => {
            const next = [...list]
            next[index] = isObject ? { ...(entry as JsonRecord), package: value } : value
            set(next)
          }}
          mono
          placeholder={tx('package name or ./local-plugin.js', '包名或 ./local-plugin.js', lang)}
        />
      ),
    },
    {
      key: 'options',
      label: 'options',
      desc: tx('Optional plugin options object.', '可选的插件配置对象。', lang),
      drill: {
        title: 'options',
        preview: isObject ? previewValue(entry.options, lang) : tx('not set', '未设置', lang),
        render: () => (
          <KeyValueField
            value={options}
            onChange={value => {
              const next = [...list]
              next[index] = { package: name, options: value }
              set(next)
            }}
          />
        ),
      },
    },
  ]
  return <DrillFields fields={fields} isConfigured={key => (key === 'package' ? name !== '' : isObject && hasOwn(entry, 'options'))} lang={lang} />
}

function MediaSection({ config, setConfig, lang }: SectionProps) {
  const image = getObject(getObject(config, 'media'), 'image')
  const set = (key: string, v: unknown) => setConfig(setNested(config, ['media', 'image', key], v))
  const fields: FieldDef[] = [
    { key: 'auto_resize', label: 'image.auto_resize', desc: tx('Resize oversized images before sending (default: true).', '发送前缩放超限图片（默认 true）。', lang), control: <BoolField value={image.auto_resize !== false} onChange={v => set('auto_resize', v)} /> },
    { key: 'max_width', label: 'image.max_width', desc: tx('Max image width before resize/reject (default: 2000).', '缩放/拒绝前的最大宽度（默认 2000）。', lang), control: <PositiveIntegerField value={image.max_width} onChange={v => set('max_width', v)} /> },
    { key: 'max_height', label: 'image.max_height', desc: tx('Max image height before resize/reject (default: 2000).', '缩放/拒绝前的最大高度（默认 2000）。', lang), control: <PositiveIntegerField value={image.max_height} onChange={v => set('max_height', v)} /> },
    { key: 'max_base64_bytes', label: 'image.max_base64_bytes', desc: tx('Max base64 payload bytes (default: 5242880).', 'base64 最大字节数（默认 5242880）。', lang), control: <PositiveIntegerField value={image.max_base64_bytes} onChange={v => set('max_base64_bytes', v)} /> },
  ]
  return (
    <SectionShell id="media" lang={lang}>
      <DrillFields fields={fields} isConfigured={key => hasNested(config, ['media', 'image', key])} lang={lang} />
    </SectionShell>
  )
}

function RuntimeSection({ config, setConfig, lang }: SectionProps) {
  const root = config as JsonRecord
  const toolOutput = getObject(config, 'tool_output')
  const compaction = getObject(config, 'compaction')
  const keep = getObject(compaction, 'keep')
  const watcher = getObject(config, 'watcher')
  const worktree = getObject(config, 'worktree')
  const fields: FieldDef[] = [
    { key: 'tool_output.max_lines', label: 'tool_output.max_lines', desc: tx('Max lines of tool output before truncation (default: 2000).', '工具输出截断前的最大行数（默认 2000）。', lang), control: <PositiveIntegerField value={toolOutput.max_lines} onChange={v => setConfig(setNested(config, ['tool_output', 'max_lines'], v))} /> },
    { key: 'tool_output.max_bytes', label: 'tool_output.max_bytes', desc: tx('Max bytes of tool output before truncation (default: 51200).', '工具输出截断前的最大字节（默认 51200）。', lang), control: <PositiveIntegerField value={toolOutput.max_bytes} onChange={v => setConfig(setNested(config, ['tool_output', 'max_bytes'], v))} /> },
    { key: 'compaction.auto', label: 'compaction.auto', desc: tx('Auto-compact the context when it fills up (default: true).', '上下文填满时自动压缩（默认 true）。', lang), control: <BoolField value={compaction.auto !== false} onChange={v => setConfig(setNested(config, ['compaction', 'auto'], v))} /> },
    { key: 'compaction.keep.tokens', label: 'compaction.keep.tokens', desc: tx('Tokens from recent turns kept verbatim during compaction.', '压缩时原样保留的最近轮次 token 数。', lang), control: <IntegerField value={keep.tokens} min={0} onChange={v => setConfig(setNested(config, ['compaction', 'keep', 'tokens'], v))} /> },
    { key: 'compaction.buffer', label: 'compaction.buffer', desc: tx('Token buffer reserved to avoid overflow during compaction.', '压缩时预留的 token 缓冲，避免溢出。', lang), control: <IntegerField value={compaction.buffer} min={0} onChange={v => setConfig(setNested(config, ['compaction', 'buffer'], v))} /> },
    { key: 'watcher.ignore', label: 'watcher.ignore', block: true, desc: tx('Glob patterns the file watcher should ignore.', '文件监听忽略的通配符。', lang), control: <StringListField value={watcher.ignore} onChange={v => setConfig(setNested(config, ['watcher', 'ignore'], v))} mono /> },
    {
      key: 'websearch',
      label: 'websearch',
      desc: tx("Web search provider selection: false to disable, or 'random' / a provider id.", "联网搜索的渠道选择：false 禁用，或 'random' / 具体 provider id。", lang),
      control: <WebsearchField value={root.websearch} onChange={v => setConfig(setRoot(config, 'websearch', v))} onClear={() => setConfig(unsetRoot(config, 'websearch'))} lang={lang} />,
    },
    { key: 'worktree.directory', label: 'worktree.directory', desc: tx("Parent directory for new worktrees, relative to the project's primary checkout when not absolute.", '新建 worktree 的父目录，非绝对路径时相对项目主检出目录。', lang), control: <TextField value={worktree.directory} onChange={v => setConfig(setNested(config, ['worktree', 'directory'], v))} mono /> },
    {
      key: 'warming',
      label: 'warming',
      desc: tx('Keep recently active sessions warm with transient requests (default: false).', '用瞬时请求保持最近活跃会话预热（默认 false）。', lang),
      control: <WarmingField value={root.warming} onChange={v => setConfig(setRoot(config, 'warming', v))} onClear={() => setConfig(unsetRoot(config, 'warming'))} lang={lang} />,
    },
  ]
  return (
    <SectionShell id="runtime" lang={lang}>
      <DrillFields
        fields={fields}
        isConfigured={key => (key === 'websearch' || key === 'warming' ? hasRoot(config, key) : hasNested(config, key.split('.')))}
        lang={lang}
      />
    </SectionShell>
  )
}

function WebsearchField({ value, onChange, onClear, lang }: { value: unknown; onChange: (value: unknown) => void; onClear: () => void; lang: Lang }) {
  const mode = value === false ? 'false' : isRecord(value) ? 'provider' : 'unset'
  const provider = isRecord(value) && typeof value.provider === 'string' ? value.provider : ''
  return (
    <div className="space-y-2">
      <Select
        value={mode}
        options={[
          ...(mode === 'unset' ? [{ value: 'unset', label: tx('not set', '未设置', lang) }] : []),
          { value: 'false', label: tx('disabled (false)', '禁用（false）', lang) },
          { value: 'provider', label: tx('use a provider', '指定渠道', lang) },
        ]}
        onChange={next => {
          if (next === 'false') onChange(false)
          else if (next === 'provider') onChange({ provider: provider || 'random' })
          else onClear()
        }}
      />
      {mode === 'provider' && (
        <Select
          editable
          value={provider}
          options={[{ value: 'random', label: tx('random', '随机', lang) }]}
          onChange={v => onChange({ provider: v })}
          placeholder={tx('provider id or random', 'provider id 或 random', lang)}
        />
      )}
    </div>
  )
}

function WarmingField({ value, onChange, onClear, lang }: { value: unknown; onChange: (value: unknown) => void; onClear: () => void; lang: Lang }) {
  const mode = typeof value === 'boolean' ? (value ? 'on' : 'off') : isRecord(value) ? 'custom' : 'unset'
  const record = isRecord(value) ? value : {}
  const set = (key: string, v: unknown) => onChange({ ...record, [key]: v })
  return (
    <div className="space-y-3">
      <Select
        value={mode}
        options={[
          ...(mode === 'unset' ? [{ value: 'unset', label: tx('not set', '未设置', lang) }] : []),
          { value: 'on', label: tx('on (defaults)', '开启（默认值）', lang) },
          { value: 'off', label: tx('off (false)', '关闭（false）', lang) },
          { value: 'custom', label: tx('custom settings', '自定义设置', lang) },
        ]}
        onChange={next => {
          if (next === 'on') onChange(true)
          else if (next === 'off') onChange(false)
          else if (next === 'custom') onChange({})
          else onClear()
        }}
      />
      {mode === 'custom' && (
        <div className="divide-y divide-border-200/35">
          <FieldRow label="prompt" desc={tx('Prompt sent for keep-alive requests.', '保持活跃请求发送的 prompt。', lang)} control={<TextField value={record.prompt} onChange={v => set('prompt', v)} />} />
          <FieldRow label="interval" desc={tx('Idle time between keep-alive requests (e.g. "4 minutes").', '保持活跃请求之间的空闲时间（如 "4 minutes"）。', lang)} control={<TextField value={record.interval} onChange={v => set('interval', v)} mono placeholder="4 minutes" />} />
          <FieldRow label="duration" desc={tx('How long to keep a session warm after its last request (e.g. "30 minutes").', '最后一次请求后继续预热会话的时长（如 "30 minutes"）。', lang)} control={<TextField value={record.duration} onChange={v => set('duration', v)} mono placeholder="30 minutes" />} />
        </div>
      )}
    </div>
  )
}

function ExperimentalSection({ config, setConfig, lang }: SectionProps) {
  const exp = getObject(config, 'experimental')
  const set = (key: string, v: unknown) => setConfig(setNested(config, ['experimental', key], v))
  const fields: FieldDef[] = [
    { key: 'portable_shell_scanner', label: 'portable_shell_scanner', desc: tx('Enable the portable shell permission scanner (default: false).', '启用可移植的 shell 权限扫描器（默认 false）。', lang), control: <BoolField value={exp.portable_shell_scanner} onChange={v => set('portable_shell_scanner', v)} /> },
    { key: 'subagent_depth', label: 'subagent_depth', desc: tx('Maximum subagent nesting depth (default: 1).', '子 agent 最大嵌套深度（默认 1）。', lang), control: <IntegerField value={exp.subagent_depth} min={0} onChange={v => set('subagent_depth', v)} /> },
    {
      key: 'policies',
      label: 'policies',
      desc: tx('Ordered policies controlling access to configured resources.', '控制已配置资源访问的有序策略。', lang),
      drill: { title: 'policies', preview: previewValue(exp.policies, lang), render: () => <PolicyEditor value={exp.policies} onChange={v => set('policies', v)} lang={lang} /> },
    },
  ]
  return (
    <SectionShell id="experimental" lang={lang}>
      <DrillFields fields={fields} isConfigured={key => key in exp} lang={lang} />
    </SectionShell>
  )
}

function PolicyEditor({ value, onChange, lang }: { value: unknown; onChange: (value: unknown[]) => void; lang: Lang }) {
  const list = Array.isArray(value) ? value : []
  return (
    <div className="space-y-1">
      {list.length === 0 && (
        <div className="py-2 text-[length:var(--fs-sm)] text-text-400">
          {tx('No policies yet. Add one below.', '还没有策略，可在下方添加。', lang)}
        </div>
      )}
      <div className="divide-y divide-border-200/35">
        {list.map((entry, index) => {
          const rec = isRecord(entry) ? entry : {}
          const setRule = (next: JsonRecord) => onChange(list.map((item, i) => (i === index ? next : item)))
          return (
            <div key={index} className="space-y-2.5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 text-[length:var(--fs-xs)] text-text-400">{tx('Action', '动作', lang)}</div>
                  <Select value={rec.action} options={enumChoices(POLICY_ACTIONS)} onChange={v => setRule({ ...rec, action: v })} />
                </div>
                <div className="w-[120px] shrink-0">
                  <div className="mb-1 text-[length:var(--fs-xs)] text-text-400">{tx('Effect', '效果', lang)}</div>
                  <Select value={rec.effect} options={enumChoices(POLICY_EFFECTS)} onChange={v => setRule({ ...rec, effect: v })} />
                </div>
                <button
                  type="button"
                  onClick={() => onChange(list.filter((_, i) => i !== index))}
                  className="mt-5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-text-300 transition-colors hover:bg-bg-200/40 hover:text-error-100"
                  title={tx('Remove', '删除', lang)}
                >
                  <TrashIcon size={14} />
                </button>
              </div>
              <div>
                <div className="mb-1 text-[length:var(--fs-xs)] text-text-400">{tx('Resource', '资源', lang)}</div>
                <TextField value={rec.resource} onChange={v => setRule({ ...rec, resource: v })} placeholder={tx('e.g. anthropic/*', '例如 anthropic/*', lang)} mono />
              </div>
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => onChange([...list, { action: POLICY_ACTIONS[0], effect: POLICY_EFFECTS[0], resource: '' }])}
        className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border-200 px-2.5 text-[length:var(--fs-sm)] font-medium text-text-100 transition-colors hover:border-border-300"
      >
        <PlusIcon size={13} />
        {tx('Add policy', '添加策略', lang)}
      </button>
    </div>
  )
}

function AdvancedSection({ config, setConfig, lang }: SectionProps) {
  const [editingUnknown, setEditingUnknown] = useState(false)
  const rest = Object.entries(config as JsonRecord).filter(([key]) => !KNOWN_ROOT_KEYS.has(key))
  return (
    <SectionShell id="advanced" lang={lang}>
      <div className="mb-3 space-y-2 rounded-lg border border-warning-100/25 bg-warning-100/10 px-3 py-2 text-[length:var(--fs-xs)] leading-relaxed text-warning-100">
        <div>{tx('The official schema has additionalProperties=false. These fields are read-only by default.', '官方 schema 设置了 additionalProperties=false。这些字段默认只读。', lang)}</div>
        {rest.length > 0 && !editingUnknown && (
          <button type="button" onClick={() => setEditingUnknown(true)} className="rounded-md border border-warning-100/40 px-2 py-1 text-warning-100 transition-colors hover:bg-warning-100/10">
            {tx('Edit anyway', '仍然编辑', lang)}
          </button>
        )}
      </div>
      {rest.length === 0 ? (
        <EmptyHint text={tx('No unrecognized fields. Everything is editable in the sections above.', '没有未识别字段，全部都能在上面的分区里编辑。', lang)} />
      ) : (
        <div className="space-y-1">
          {rest.map(([key, value]) => (
            editingUnknown ? (
              <FieldRow
                key={key}
                label={key}
                desc={previewValue(value, lang)}
                control={
                  typeof value === 'boolean' ? (
                    <BoolField value={value} onChange={v => setConfig(setRoot(config, key, v))} />
                  ) : typeof value === 'number' ? (
                    <NumberField value={value} onChange={v => setConfig(setRoot(config, key, v))} />
                  ) : Array.isArray(value) ? (
                    <JsonStructuredEditor value={value} type="array" onChange={v => setConfig(setRoot(config, key, v))} />
                  ) : isRecord(value) ? (
                    <KeyValueField value={value} onChange={v => setConfig(setRoot(config, key, v))} />
                  ) : (
                    <TextField value={value} onChange={v => setConfig(setRoot(config, key, v))} />
                  )
                }
              />
            ) : (
              <FieldRow key={key} label={key} desc={tx('Read-only unknown field.', '只读未知字段。', lang)} control={<div className="truncate rounded-lg border border-border-200/40 bg-bg-100/40 px-3 py-2 font-mono text-[length:var(--fs-xs)] text-text-400">{previewValue(value, lang)}</div>} />
            )
          ))}
        </div>
      )}
    </SectionShell>
  )
}

export function SectionRouter(props: SectionProps & { section: SectionID }) {
  switch (props.section) {
    case 'general':
      return <GeneralSection {...props} />
    case 'commands':
      return <CommandsSection {...props} />
    case 'skills':
      return <SkillsSection {...props} />
    case 'plugins':
      return <PluginsSection {...props} />
    case 'providers':
      return <ProvidersSection {...props} />
    case 'agents':
      return <AgentsSection {...props} />
    case 'mcp':
      return <McpSection {...props} />
    case 'permissions':
      return <PermissionsSection {...props} />
    case 'formatters':
      return <FormatterSection {...props} />
    case 'lsp':
      return <LspSection {...props} />
    case 'media':
      return <MediaSection {...props} />
    case 'runtime':
      return <RuntimeSection {...props} />
    case 'experimental':
      return <ExperimentalSection {...props} />
    case 'advanced':
      return <AdvancedSection {...props} />
  }
}
