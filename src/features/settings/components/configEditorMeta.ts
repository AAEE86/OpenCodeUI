import type { SectionID } from './configEditorTypes'

export const SECTION_META: Record<SectionID, { en: string; zh: string; descEn: string; descZh: string }> = {
  general: {
    en: 'General',
    zh: '通用',
    descEn: 'Core settings: default model, agent, shell, sharing, updates and enterprise.',
    descZh: '核心设置：默认模型、默认 agent、shell、分享、自动更新与企业配置。',
  },
  commands: {
    en: 'Commands',
    zh: '自定义命令',
    descEn: 'Custom slash commands. Each command has a prompt template.',
    descZh: '自定义斜杠命令，每条命令带一个 prompt 模板。',
  },
  skills: {
    en: 'Skills & References',
    zh: '技能与引用',
    descEn: 'Extra skill folders/URLs and named @ references.',
    descZh: '额外的技能目录/URL，以及可用 @ 提及的命名引用。',
  },
  plugins: {
    en: 'Plugins',
    zh: '插件',
    descEn: 'Plugin package specs or local plugin files, with optional options.',
    descZh: '插件包名或本地插件文件，可附带配置项。',
  },
  providers: {
    en: 'Providers & Models',
    zh: '渠道与模型',
    descEn: 'Custom provider configuration and per-model overrides.',
    descZh: '自定义渠道（provider）配置以及单个模型的覆盖项。',
  },
  agents: {
    en: 'Agents',
    zh: 'Agent',
    descEn: 'Built-in and custom agent overrides (model, system prompt, request body, permissions).',
    descZh: '内置与自定义 agent 的覆盖（模型、系统提示词、请求体、权限等）。',
  },
  mcp: {
    en: 'MCP Servers',
    zh: 'MCP 服务',
    descEn: 'Configure MCP servers with a local command or remote URL.',
    descZh: '配置本地命令或远程 URL 的 MCP 服务。',
  },
  permissions: {
    en: 'Permissions',
    zh: '权限',
    descEn: 'Ordered permission rules applied to agent tool use.',
    descZh: '按顺序应用的工具权限规则。',
  },
  formatters: {
    en: 'Formatters',
    zh: '格式化器',
    descEn: 'Enable built-in formatters or override individual formatter entries.',
    descZh: '启用内置格式化器，或覆盖单个格式化器配置。',
  },
  lsp: {
    en: 'LSP Servers',
    zh: 'LSP 服务',
    descEn: 'Enable built-in language servers or define custom ones.',
    descZh: '启用内置语言服务器，或定义自定义 LSP。',
  },
  media: {
    en: 'Media',
    zh: '媒体',
    descEn: 'Image processing limits and auto-resize behavior.',
    descZh: '图片处理的尺寸限制与自动缩放行为。',
  },
  runtime: {
    en: 'Runtime',
    zh: '运行时',
    descEn: 'Tool output limits, compaction, watcher, web search, worktree and warming.',
    descZh: '工具输出限制、上下文压缩、文件监听、联网搜索、worktree 与预热。',
  },
  experimental: {
    en: 'Experimental',
    zh: '实验性',
    descEn: 'Experimental flags that may change or be removed in future versions.',
    descZh: '实验性开关，未来版本可能变化或移除。',
  },
  advanced: {
    en: 'Unknown / Future',
    zh: '未知/未来字段',
    descEn: 'Top-level fields not recognized by the current schema. They may be invalid or from a newer opencode version.',
    descZh: '当前 schema 不认识的顶层字段，可能无效，也可能来自更新版本的 opencode。',
  },
}

export const SECTION_IDS: SectionID[] = [
  'general',
  'commands',
  'skills',
  'plugins',
  'providers',
  'agents',
  'mcp',
  'permissions',
  'formatters',
  'lsp',
  'media',
  'runtime',
  'experimental',
  'advanced',
]

/** OpenCode v2 顶层配置键（对应 `packages/schema/src/config.ts` 的 `Info`）。 */
export const KNOWN_ROOT_KEYS = new Set([
  '$schema',
  'shell',
  'model',
  'default_agent',
  'update',
  'share',
  'enterprise',
  'username',
  'permissions',
  'agents',
  'snapshots',
  'watcher',
  'formatter',
  'lsp',
  'media',
  'tool_output',
  'mcp',
  'compaction',
  'skills',
  'commands',
  'instructions',
  'references',
  'websearch',
  'plugins',
  'worktree',
  'warming',
  'providers',
  'experimental',
])

/**
 * v2 权限规则的建议 action 列表。
 *
 * v2 把 `bash`/`task` 分别改名为 `shell`/`subagent`，`write`/`patch` 合并为 `edit`。
 * 规则本身是字符串，这里只是给下拉框的建议值，用户仍可手填任意 action。
 */
export const PERMISSION_ACTIONS: { action: string; en: string; zh: string }[] = [
  { action: '*', en: 'Everything', zh: '全部' },
  { action: 'read', en: 'Read files', zh: '读取文件' },
  { action: 'edit', en: 'Edit / write files', zh: '编辑/写入文件' },
  { action: 'glob', en: 'Find files by glob', zh: '按通配符查找文件' },
  { action: 'grep', en: 'Search file contents', zh: '搜索文件内容' },
  { action: 'list', en: 'List directories', zh: '列出目录' },
  { action: 'shell', en: 'Run shell commands', zh: '执行 shell 命令' },
  { action: 'subagent', en: 'Spawn sub-agents', zh: '启动子 agent' },
  { action: 'external_directory', en: 'Access dirs outside workspace', zh: '访问工作区外目录' },
  { action: 'lsp', en: 'Language server actions', zh: '语言服务器操作' },
  { action: 'skill', en: 'Load skills', zh: '加载技能' },
  { action: 'question', en: 'Ask the user questions', zh: '向用户提问' },
  { action: 'webfetch', en: 'Fetch web pages', zh: '抓取网页' },
  { action: 'websearch', en: 'Search the web', zh: '联网搜索' },
]

export const PERMISSION_ACTION_NAMES = PERMISSION_ACTIONS.map(item => item.action)

/** v2 权限规则的效果取值。 */
export const PERMISSION_EFFECTS = ['allow', 'deny', 'ask']

/** v2 策略（experimental.policies）的 action 取值。 */
export const POLICY_ACTIONS = ['provider.use', 'tool.use', 'integration.use']

export const POLICY_EFFECTS = ['allow', 'deny']

export const MODALITIES = ['text', 'audio', 'image', 'video', 'pdf']
