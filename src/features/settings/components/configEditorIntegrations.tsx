import type { Config } from '../../../types/api/config'
import { DrillChild, DrillRow } from './configEditorDrill'
import { useDrillContainer, useDrillState } from './configEditorDrillState'
import { BoolField, KeyValueField, PortField, PositiveIntegerField, Select, StringListField, StringMapField, TextField } from './configEditorControls'
import { DrillFields, DuplicateIdField, FieldRow, NamedDrillList, SectionShell, type FieldDef } from './configEditorFields'
import type { SectionProps } from './configEditorSectionTypes'
import type { JsonRecord, Lang } from './configEditorTypes'
import { clone, getObject, isRecord, previewValue, setNested, setRoot, tx } from './configEditorUtils'

export function McpSection(props: SectionProps) {
  return (
    <SectionShell id="mcp" lang={props.lang}>
      <McpHome {...props} />
    </SectionShell>
  )
}

function McpHome({ config, setConfig, lang }: SectionProps) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const mcp = getObject(config, 'mcp')
  const servers = getObject(mcp, 'servers')
  const names = Object.keys(servers).sort()
  const selected = activeChildId?.startsWith('mcp:') ? activeChildId.slice('mcp:'.length) : ''

  if (activeChildId === 'timeout') {
    return (
      <DrillChild depth={depth}>
        <McpTimeoutEditor
          value={mcp.timeout}
          onChange={v => setConfig(setNested(config, ['mcp', 'timeout'], v))}
          lang={lang}
        />
      </DrillChild>
    )
  }

  if (selected) {
    return (
      <DrillChild depth={depth}>
        <McpDetail config={config} setConfig={setConfig} lang={lang} name={selected} />
      </DrillChild>
    )
  }

  return (
    <div className="space-y-3">
      <DrillRow
        label="timeout"
        desc={tx('Startup, catalog and execution timeouts applied to all MCP servers.', '应用到所有 MCP 服务的启动、目录与执行超时。', lang)}
        preview={previewValue(mcp.timeout, lang)}
        onClick={() => enter({ id: 'timeout', title: 'timeout' })}
      />
      <NamedDrillList
        lang={lang}
        items={names}
        addPlaceholder={tx('server name', '服务名', lang)}
        onOpen={name => enter({ id: `mcp:${name}`, title: name })}
        onAdd={name => setConfig(setNested(config, ['mcp', 'servers', name], { type: 'local', command: [] }))}
        renderPreview={name => {
          const entry = isRecord(servers[name]) ? (servers[name] as JsonRecord) : {}
          return String(entry.type ?? 'local')
        }}
        emptyText={tx('Add an MCP server to configure it.', '添加一个 MCP 服务进行配置。', lang)}
      />
    </div>
  )
}

function McpTimeoutEditor({ value, onChange, lang }: { value: unknown; onChange: (value: JsonRecord) => void; lang: Lang }) {
  const rec = isRecord(value) ? value : {}
  const set = (key: string, v: unknown) => onChange({ ...rec, [key]: v })
  const fields: FieldDef[] = [
    { key: 'startup', label: 'startup', desc: tx('Max time in ms to establish and initialize the server.', '建立并初始化服务的最大毫秒数。', lang), control: <PositiveIntegerField value={rec.startup} onChange={v => set('startup', v)} /> },
    { key: 'catalog', label: 'catalog', desc: tx('Max time in ms for discovery requests such as tools/list.', '发现请求（如 tools/list）的最大毫秒数。', lang), control: <PositiveIntegerField value={rec.catalog} onChange={v => set('catalog', v)} /> },
    { key: 'execution', label: 'execution', desc: tx('Max time in ms for tool and prompt execution.', '工具与 prompt 执行的最大毫秒数。', lang), control: <PositiveIntegerField value={rec.execution} onChange={v => set('execution', v)} /> },
  ]
  return <DrillFields fields={fields} isConfigured={key => key in rec} lang={lang} />
}

function McpDetail({ config, setConfig, lang, name }: { config: Config; setConfig: (config: Config) => void; lang: Lang; name: string }) {
  const drill = useDrillState()
  const { activeChildId } = useDrillContainer()
  const servers = getObject(getObject(config, 'mcp'), 'servers')
  const item = servers[name]
  const value = isRecord(item) ? item : {}
  const set = (next: JsonRecord) => setConfig(setNested(config, ['mcp', 'servers', name], next))
  const type = value.type === 'remote' ? 'remote' : 'local'
  const oauth = isRecord(value.oauth) ? value.oauth : {}

  const fields: FieldDef[] = [
    {
      key: 'type',
      label: 'type',
      desc: tx('Local command or remote URL server.', '本地命令或远程 URL 服务。', lang),
      control: (
        <Select
          value={type}
          options={[
            { value: 'local', label: tx('local (command)', 'local（命令）', lang) },
            { value: 'remote', label: tx('remote (url)', 'remote（URL）', lang) },
          ]}
          onChange={next => set(next === 'remote' ? { type: 'remote', url: '' } : { type: 'local', command: [] })}
        />
      ),
    },
    ...(type === 'local'
      ? [
          { key: 'command', label: 'command', badge: tx('required', '必填', lang), block: true, desc: tx('Command and arguments, one per line.', '命令和参数，每行一个。', lang), control: <StringListField value={value.command} onChange={v => set({ ...value, command: v })} mono placeholder="npx" /> },
          { key: 'cwd', label: 'cwd', desc: tx('Working directory for the MCP process.', 'MCP 进程的工作目录。', lang), control: <TextField value={value.cwd} onChange={v => set({ ...value, cwd: v })} mono /> },
          { key: 'environment', label: 'environment', desc: tx('Environment variables for the server process.', '服务进程的环境变量。', lang), drill: { title: 'environment', preview: previewValue(value.environment, lang), render: () => <StringMapField value={value.environment} onChange={v => set({ ...value, environment: v })} /> } },
        ]
      : [
          { key: 'url', label: 'url', badge: tx('required', '必填', lang), desc: tx('URL of the remote MCP server.', '远程 MCP 服务的 URL。', lang), control: <TextField value={value.url} onChange={v => set({ ...value, url: v })} mono /> },
          { key: 'headers', label: 'headers', desc: tx('Headers sent with the request.', '请求携带的 headers。', lang), drill: { title: 'headers', preview: previewValue(value.headers, lang), render: () => <StringMapField value={value.headers} onChange={v => set({ ...value, headers: v })} /> } },
          {
            key: 'oauth',
            label: 'oauth',
            desc: tx('OAuth config, or disable auto-detection.', 'OAuth 配置，或关闭自动检测。', lang),
            drill: {
              title: 'oauth',
              preview: value.oauth === false ? 'false' : previewValue(value.oauth, lang),
              render: () => (
                <div className="space-y-3">
                  <Select
                    value={value.oauth === false ? 'false' : 'object'}
                    options={[
                      { value: 'object', label: tx('configure OAuth', '配置 OAuth', lang) },
                      { value: 'false', label: tx('disable (false)', '禁用（false）', lang) },
                    ]}
                    onChange={next => set({ ...value, oauth: next === 'false' ? false : {} })}
                  />
                  {value.oauth !== false && (
                    <DrillFields
                      fields={[
                        { key: 'client_id', label: 'client_id', desc: tx('OAuth client id.', 'OAuth client id。', lang), control: <TextField value={oauth.client_id} onChange={v => set({ ...value, oauth: { ...oauth, client_id: v } })} mono /> },
                        { key: 'client_secret', label: 'client_secret', desc: tx('OAuth client secret.', 'OAuth client secret。', lang), control: <TextField value={oauth.client_secret} onChange={v => set({ ...value, oauth: { ...oauth, client_secret: v } })} mono /> },
                        { key: 'scope', label: 'scope', desc: tx('Requested OAuth scopes.', '请求的 OAuth scope。', lang), control: <TextField value={oauth.scope} onChange={v => set({ ...value, oauth: { ...oauth, scope: v } })} /> },
                        { key: 'callback_port', label: 'callback_port', desc: tx('Local callback port (1-65535).', '本地回调端口（1-65535）。', lang), control: <PortField value={oauth.callback_port} onChange={v => set({ ...value, oauth: { ...oauth, callback_port: v } })} /> },
                        { key: 'redirect_uri', label: 'redirect_uri', desc: tx('OAuth redirect URI.', 'OAuth 重定向 URI。', lang), control: <TextField value={oauth.redirect_uri} onChange={v => set({ ...value, oauth: { ...oauth, redirect_uri: v } })} mono /> },
                        { key: 'auth_server_metadata_url', label: 'auth_server_metadata_url', desc: tx('Authorization server metadata URL, when the server does not publish it.', '授权服务器元数据 URL，服务端未发布时使用。', lang), control: <TextField value={oauth.auth_server_metadata_url} onChange={v => set({ ...value, oauth: { ...oauth, auth_server_metadata_url: v } })} mono /> },
                      ]}
                      isConfigured={key => key in oauth}
                      lang={lang}
                    />
                  )}
                </div>
              ),
            },
          },
        ]),
    { key: 'disabled', label: 'disabled', desc: tx('Disable this server on startup.', '启动时禁用该服务。', lang), control: <BoolField value={value.disabled} onChange={v => set({ ...value, disabled: v })} /> },
    { key: 'codemode', label: 'codemode', desc: tx("Expose this server's tools through Code Mode (default true).", '通过 Code Mode 暴露该服务的工具（默认 true）。', lang), control: <BoolField value={value.codemode} onChange={v => set({ ...value, codemode: v })} /> },
    { key: 'timeout', label: 'timeout', desc: tx('Per-server timeouts (startup/catalog/execution).', '该服务的超时（startup/catalog/execution）。', lang), drill: { title: 'timeout', preview: previewValue(value.timeout, lang), render: () => <McpTimeoutEditor value={value.timeout} onChange={v => set({ ...value, timeout: v })} lang={lang} /> } },
    { key: 'protocol', label: 'protocol', desc: tx('MCP protocol negotiation mode.', 'MCP 协议协商模式。', lang), control: <Select value={value.protocol} options={[{ value: 'legacy', label: 'legacy' }, { value: 'auto', label: 'auto' }, { value: '2026-07-28', label: '2026-07-28' }]} onChange={v => set({ ...value, protocol: v })} /> },
  ]

  return (
    <div className="space-y-6">
      {!activeChildId && (
        <DuplicateIdField
          sourceId={name}
          existing={servers}
          lang={lang}
          onCopy={targetId => {
            setConfig(setNested(config, ['mcp', 'servers', targetId], clone(value)))
            drill.replace(0, { id: `mcp:${targetId}`, title: targetId })
          }}
        />
      )}
      <DrillFields fields={fields} isConfigured={key => key in value} lang={lang} />
    </div>
  )
}

export function FormatterSection(props: SectionProps) {
  return (
    <SectionShell id="formatters" lang={props.lang}>
      <FormatterHome {...props} />
    </SectionShell>
  )
}

function FormatterHome({ config, setConfig, lang }: SectionProps) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const value = (config as JsonRecord).formatter
  const mode = typeof value === 'boolean' ? (value ? 'on' : 'off') : isRecord(value) ? 'custom' : 'unset'
  const record = isRecord(value) ? value : {}
  const names = Object.keys(record)
  const selected = activeChildId?.startsWith('formatter:') ? activeChildId.slice('formatter:'.length) : ''
  if (selected) {
    return (
      <DrillChild depth={depth}>
        <FormatterEntry config={config} setConfig={setConfig} lang={lang} name={selected} />
      </DrillChild>
    )
  }

  return (
    <div className="space-y-3">
      <FieldRow
        label="formatter"
        desc={tx('Off disables all; On enables built-ins; Custom overrides entries.', 'Off 全部禁用；On 启用内置；Custom 覆盖单个配置。', lang)}
        control={
          <Select
            value={mode}
            options={[
              ...(mode === 'unset' ? [{ value: 'unset', label: tx('not set', '未设置', lang) }] : []),
              { value: 'on', label: tx('on (built-ins)', 'on（启用内置）', lang) },
              { value: 'off', label: tx('off (disabled)', 'off（禁用）', lang) },
              { value: 'custom', label: tx('custom entries', '自定义条目', lang) },
            ]}
            onChange={next => {
              if (mode === 'custom' && names.length > 0 && next !== 'custom' && !window.confirm(tx('Changing formatter mode will replace all custom entries. Continue?', '切换 formatter 模式会替换全部自定义条目，是否继续？', lang))) return
              if (next === 'on') setConfig(setRoot(config, 'formatter', true))
              else if (next === 'off') setConfig(setRoot(config, 'formatter', false))
              else if (next === 'custom') setConfig(setRoot(config, 'formatter', isRecord(value) ? value : {}))
            }}
          />
        }
      />
      {mode === 'custom' && (
        <NamedDrillList
          lang={lang}
          items={names}
          addPlaceholder={tx('formatter name', '格式化器名', lang)}
          onOpen={name => enter({ id: `formatter:${name}`, title: name })}
          onAdd={name => setConfig(setNested(config, ['formatter', name], { disabled: false }))}
          emptyText={tx('Add a formatter entry.', '添加一个格式化器配置。', lang)}
        />
      )}
    </div>
  )
}

function FormatterEntry({ config, setConfig, lang, name }: { config: Config; setConfig: (config: Config) => void; lang: Lang; name: string }) {
  const drill = useDrillState()
  const { activeChildId } = useDrillContainer()
  const record = getObject(config, 'formatter')
  const entry = isRecord(record[name]) ? (record[name] as JsonRecord) : {}
  const setEntry = (next: JsonRecord) => setConfig(setNested(config, ['formatter', name], next))
  const fields: FieldDef[] = [
    { key: 'command', label: 'command', block: true, desc: tx('Command and args to run the formatter.', '运行格式化器的命令和参数。', lang), control: <StringListField value={entry.command} onChange={v => setEntry({ ...entry, command: v })} mono /> },
    { key: 'extensions', label: 'extensions', block: true, desc: tx('File extensions this formatter handles.', '该格式化器处理的文件扩展名。', lang), control: <StringListField value={entry.extensions} onChange={v => setEntry({ ...entry, extensions: v })} mono placeholder=".ts" /> },
    { key: 'environment', label: 'environment', desc: tx('Environment variables for the formatter.', '格式化器的环境变量。', lang), drill: { title: 'environment', preview: previewValue(entry.environment, lang), render: () => <StringMapField value={entry.environment} onChange={v => setEntry({ ...entry, environment: v })} /> } },
    { key: 'disabled', label: 'disabled', desc: tx('Disable this formatter.', '禁用该格式化器。', lang), control: <BoolField value={entry.disabled} onChange={v => setEntry({ ...entry, disabled: v })} /> },
  ]
  return (
    <div className="space-y-6">
      {!activeChildId && (
        <DuplicateIdField
          sourceId={name}
          existing={record}
          lang={lang}
          onCopy={targetId => {
            setConfig(setNested(config, ['formatter', targetId], clone(entry)))
            drill.replace(0, { id: `formatter:${targetId}`, title: targetId })
          }}
        />
      )}
      <DrillFields fields={fields} isConfigured={key => key in entry} lang={lang} />
    </div>
  )
}

export function LspSection(props: SectionProps) {
  return (
    <SectionShell id="lsp" lang={props.lang}>
      <LspHome {...props} />
    </SectionShell>
  )
}

function LspHome({ config, setConfig, lang }: SectionProps) {
  const { activeChildId, enter, depth } = useDrillContainer()
  const value = (config as JsonRecord).lsp
  const mode = typeof value === 'boolean' ? (value ? 'on' : 'off') : isRecord(value) ? 'custom' : 'unset'
  const record = isRecord(value) ? value : {}
  const names = Object.keys(record)
  const selected = activeChildId?.startsWith('lsp:') ? activeChildId.slice('lsp:'.length) : ''
  if (selected) {
    return (
      <DrillChild depth={depth}>
        <LspEntry config={config} setConfig={setConfig} lang={lang} name={selected} />
      </DrillChild>
    )
  }

  return (
    <div className="space-y-3">
      <FieldRow
        label="lsp"
        desc={tx('Off disables all; On enables built-ins; Custom defines servers.', 'Off 全部禁用；On 启用内置；Custom 自定义服务器。', lang)}
        control={
          <Select
            value={mode}
            options={[
              ...(mode === 'unset' ? [{ value: 'unset', label: tx('not set', '未设置', lang) }] : []),
              { value: 'on', label: tx('on (built-ins)', 'on（启用内置）', lang) },
              { value: 'off', label: tx('off (disabled)', 'off（禁用）', lang) },
              { value: 'custom', label: tx('custom servers', '自定义服务器', lang) },
            ]}
            onChange={next => {
              if (mode === 'custom' && names.length > 0 && next !== 'custom' && !window.confirm(tx('Changing LSP mode will replace all custom servers. Continue?', '切换 LSP 模式会替换全部自定义服务，是否继续？', lang))) return
              if (next === 'on') setConfig(setRoot(config, 'lsp', true))
              else if (next === 'off') setConfig(setRoot(config, 'lsp', false))
              else if (next === 'custom') setConfig(setRoot(config, 'lsp', isRecord(value) ? value : {}))
            }}
          />
        }
      />
      {mode === 'custom' && (
        <NamedDrillList
          lang={lang}
          items={names}
          addPlaceholder={tx('lsp name', 'LSP 名', lang)}
          onOpen={name => enter({ id: `lsp:${name}`, title: name })}
          onAdd={name => setConfig(setNested(config, ['lsp', name], { command: [] }))}
          emptyText={tx('Add an LSP server.', '添加一个 LSP 服务器。', lang)}
        />
      )}
    </div>
  )
}

function LspEntry({ config, setConfig, lang, name }: { config: Config; setConfig: (config: Config) => void; lang: Lang; name: string }) {
  const drill = useDrillState()
  const { activeChildId } = useDrillContainer()
  const record = getObject(config, 'lsp')
  const entry = isRecord(record[name]) ? (record[name] as JsonRecord) : {}
  const setEntry = (next: JsonRecord) => setConfig(setNested(config, ['lsp', name], next))
  const copyField = (
    <DuplicateIdField
      sourceId={name}
      existing={record}
      lang={lang}
      onCopy={targetId => {
        setConfig(setNested(config, ['lsp', targetId], clone(entry)))
        drill.replace(0, { id: `lsp:${targetId}`, title: targetId })
      }}
    />
  )
  const entryMode = entry.disabled === true && !('command' in entry) ? 'disabled-only' : 'custom'
  if (entryMode === 'disabled-only') {
    const fields: FieldDef[] = [
      {
        key: 'mode',
        label: 'mode',
        desc: tx('LSP entry shape. disabled-only writes exactly { disabled: true }.', 'LSP 条目形态。disabled-only 只写 { disabled: true }。', lang),
        control: <Select value="disabled-only" options={[{ value: 'disabled-only', label: tx('disabled-only', '仅禁用', lang) }, { value: 'custom', label: tx('custom command', '自定义命令', lang) }]} onChange={v => setEntry(v === 'disabled-only' ? { disabled: true } : { disabled: false, command: [] })} />,
      },
    ]
    return (
      <div className="space-y-6">
        {!activeChildId && copyField}
        <DrillFields fields={fields} isConfigured={() => true} lang={lang} />
      </div>
    )
  }
  const fields: FieldDef[] = [
    {
      key: 'mode',
      label: 'mode',
      desc: tx('LSP entry shape. custom command requires command.', 'LSP 条目形态。custom command 必须配置 command。', lang),
      control: <Select value="custom" options={[{ value: 'disabled-only', label: tx('disabled-only', '仅禁用', lang) }, { value: 'custom', label: tx('custom command', '自定义命令', lang) }]} onChange={v => setEntry(v === 'disabled-only' ? { disabled: true } : { disabled: false, command: [] })} />,
    },
    { key: 'command', label: 'command', badge: tx('required', '必填', lang), block: true, desc: tx('Command and args to start the LSP.', '启动 LSP 的命令和参数。', lang), control: <StringListField value={entry.command} onChange={v => setEntry({ ...entry, command: v })} mono /> },
    { key: 'extensions', label: 'extensions', block: true, desc: tx('File extensions handled by this LSP.', '该 LSP 处理的文件扩展名。', lang), control: <StringListField value={entry.extensions} onChange={v => setEntry({ ...entry, extensions: v })} mono placeholder=".ts" /> },
    { key: 'env', label: 'env', desc: tx('Environment variables for the LSP.', 'LSP 的环境变量。', lang), drill: { title: 'env', preview: previewValue(entry.env, lang), render: () => <StringMapField value={entry.env} onChange={v => setEntry({ ...entry, env: v })} /> } },
    { key: 'initialization', label: 'initialization', desc: tx('LSP initialization options object.', 'LSP 初始化选项对象。', lang), drill: { title: 'initialization', preview: previewValue(entry.initialization, lang), render: () => <KeyValueField value={entry.initialization} onChange={v => setEntry({ ...entry, initialization: v })} /> } },
    { key: 'disabled', label: 'disabled', desc: tx('Disable this LSP server.', '禁用该 LSP 服务器。', lang), control: <BoolField value={entry.disabled} onChange={v => setEntry({ ...entry, disabled: v })} /> },
  ]
  return (
    <div className="space-y-6">
      {!activeChildId && copyField}
      <DrillFields fields={fields} isConfigured={key => key in entry} lang={lang} />
    </div>
  )
}
