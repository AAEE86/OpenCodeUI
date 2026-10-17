import { describe, expect, it } from 'vitest'
import type { Config } from '../../../types/api/config'
import { KNOWN_ROOT_KEYS } from './configEditorMeta'
import { isRecord, setNested, setRoot, unsetRoot } from './configEditorUtils'
import { validateConfig } from './configEditorValidation'

/**
 * 这份夹具不是手写的 JSON 字面量，而是走各分区控件实际使用的 setter
 * （`setRoot` / `setNested`）搭出来的，覆盖全部 14 个分区。
 *
 * 目的是把「配置编辑器能产出的形态」钉死在测试里：
 * - 顶层只能出现 v2 键（`KNOWN_ROOT_KEYS`）
 * - 产出的对象必须通过本地 v2 校验
 * - 已经改名的 v1 键不能在任何一层重新出现
 *
 * 以后谁把控件改回 v1 键名或写出非法形态，这里会红。
 */
function buildFixture(): Config {
  let config = {} as Config

  // general
  config = setRoot(config, '$schema', 'https://opencode.ai/config.json')
  config = setRoot(config, 'model', 'anthropic/claude-sonnet-4')
  config = setRoot(config, 'default_agent', 'build')
  config = setRoot(config, 'shell', '/bin/zsh')
  config = setRoot(config, 'username', 'lee')
  config = setRoot(config, 'update', 'auto')
  config = setRoot(config, 'share', 'manual')
  config = setRoot(config, 'snapshots', true)
  config = setRoot(config, 'instructions', ['AGENTS.md'])
  config = setNested(config, ['enterprise', 'url'], 'https://enterprise.example.com')

  // commands
  config = setNested(config, ['commands', 'test', 'template'], 'run the unit tests')
  config = setNested(config, ['commands', 'test', 'description'], 'test everything')
  config = setNested(config, ['commands', 'test', 'agent'], 'build')
  config = setNested(config, ['commands', 'test', 'model'], 'anthropic/claude-sonnet-4')
  config = setNested(config, ['commands', 'test', 'subagent'], true)

  // skills & references
  config = setRoot(config, 'skills', ['./skills', 'https://example.com/.well-known/skills/'])
  config = setNested(config, ['references', 'docs'], 'https://example.com/docs')
  config = setNested(config, ['references', 'repo', 'repository'], 'owner/repo')
  config = setNested(config, ['references', 'repo', 'branch'], 'main')
  config = setNested(config, ['references', 'repo', 'hidden'], false)
  config = setNested(config, ['references', 'local', 'path'], './docs')
  config = setNested(config, ['references', 'local', 'description'], 'local docs')
  config = setNested(config, ['references', 'local', 'hidden'], true)

  // plugins
  config = setRoot(config, 'plugins', ['some-plugin', { package: '@scope/p', options: { a: 1, b: 'x' } }])

  // providers
  const provider = ['providers', 'openai'] as const
  config = setNested(config, [...provider, 'name'], 'OpenAI')
  config = setNested(config, [...provider, 'canonical'], 'openai')
  config = setNested(config, [...provider, 'package'], '@ai-sdk/openai')
  config = setNested(config, [...provider, 'env'], ['OPENAI_API_KEY'])
  config = setNested(config, [...provider, 'headers'], { 'x-provider': '1' })
  config = setNested(config, [...provider, 'body'], { providerField: 1 })
  config = setNested(config, [...provider, 'settings', 'timeout'], 10000)
  config = setNested(config, [...provider, 'settings', 'headerTimeout'], 5000)
  config = setNested(config, [...provider, 'settings', 'compaction', 'type'], 'summary')
  config = setNested(config, [...provider, 'settings', 'transport'], 'http')
  const model = [...provider, 'models', 'gpt-4'] as const
  config = setNested(config, [...model, 'modelID'], 'gpt-4-0613')
  config = setNested(config, [...model, 'family'], 'gpt')
  config = setNested(config, [...model, 'name'], 'GPT-4')
  config = setNested(config, [...model, 'package'], '@ai-sdk/openai')
  config = setNested(config, [...model, 'disabled'], false)
  config = setNested(config, [...model, 'capabilities', 'tools'], true)
  config = setNested(config, [...model, 'capabilities', 'input'], ['text', 'image'])
  config = setNested(config, [...model, 'capabilities', 'output'], ['text'])
  config = setNested(config, [...model, 'compatibility', 'reasoningField'], 'reasoning_content')
  config = setNested(config, [...model, 'compatibility', 'maxTokensField'], 'max_tokens')
  config = setNested(config, [...model, 'cost', 'input'], 1)
  config = setNested(config, [...model, 'cost', 'output'], 2)
  config = setNested(config, [...model, 'cost', 'cache', 'read'], 0.1)
  config = setNested(config, [...model, 'cost', 'cache', 'write'], 0.2)
  config = setNested(config, [...model, 'cost', 'tier', 'type'], 'context')
  config = setNested(config, [...model, 'cost', 'tier', 'size'], 128000)
  config = setNested(config, [...model, 'limit', 'context'], 128000)
  config = setNested(config, [...model, 'limit', 'input'], 120000)
  config = setNested(config, [...model, 'limit', 'output'], 8000)
  config = setNested(config, [...model, 'variants'], [
    { id: 'high', settings: { compaction: { type: 'summary' } }, headers: { 'x-variant': '1' }, body: { variantField: 3 } },
  ])

  // agents
  const agent = ['agents', 'build'] as const
  config = setNested(config, [...agent, 'model'], 'anthropic/claude-sonnet-4#high')
  config = setNested(config, [...agent, 'description'], 'default agent')
  config = setNested(config, [...agent, 'mode'], 'primary')
  config = setNested(config, [...agent, 'color'], '#a1b2c3')
  config = setNested(config, [...agent, 'steps'], 5)
  config = setNested(config, [...agent, 'hidden'], false)
  config = setNested(config, [...agent, 'disabled'], false)
  config = setNested(config, [...agent, 'system'], 'You are helpful.')
  config = setNested(config, [...agent, 'request', 'headers'], { 'x-agent': '1' })
  config = setNested(config, [...agent, 'request', 'body'], { temperature: 0.2, top_p: 0.9 })
  config = setNested(config, [...agent, 'permissions'], [{ action: 'read', resource: '*', effect: 'allow' }])

  // mcp
  config = setNested(config, ['mcp', 'timeout', 'startup'], 1000)
  config = setNested(config, ['mcp', 'timeout', 'catalog'], 2000)
  config = setNested(config, ['mcp', 'timeout', 'execution'], 3000)
  const local = ['mcp', 'servers', 'local1'] as const
  config = setNested(config, [...local, 'type'], 'local')
  config = setNested(config, [...local, 'command'], ['npx', '-y', 'server'])
  config = setNested(config, [...local, 'cwd'], '/tmp')
  config = setNested(config, [...local, 'environment'], { K: 'v' })
  config = setNested(config, [...local, 'disabled'], false)
  config = setNested(config, [...local, 'codemode'], true)
  config = setNested(config, [...local, 'timeout', 'startup'], 10)
  config = setNested(config, [...local, 'protocol'], 'auto')
  const remote = ['mcp', 'servers', 'remote1'] as const
  config = setNested(config, [...remote, 'type'], 'remote')
  config = setNested(config, [...remote, 'url'], 'https://mcp.example.com')
  config = setNested(config, [...remote, 'headers'], { Authorization: 'Bearer x' })
  config = setNested(config, [...remote, 'oauth', 'client_id'], 'client')
  config = setNested(config, [...remote, 'oauth', 'client_secret'], 'secret')
  config = setNested(config, [...remote, 'oauth', 'scope'], 'read write')
  config = setNested(config, [...remote, 'oauth', 'callback_port'], 8080)
  config = setNested(config, [...remote, 'oauth', 'redirect_uri'], 'http://localhost/callback')
  config = setNested(config, [...remote, 'oauth', 'auth_server_metadata_url'], 'https://auth.example.com/.well-known')
  config = setNested(config, [...remote, 'disabled'], false)
  config = setNested(config, ['mcp', 'servers', 'remote2', 'type'], 'remote')
  config = setNested(config, ['mcp', 'servers', 'remote2', 'url'], 'https://mcp2.example.com')
  config = setNested(config, ['mcp', 'servers', 'remote2', 'oauth'], false)

  // permissions
  config = setRoot(config, 'permissions', [
    { action: '*', resource: '*', effect: 'ask' },
    { action: 'shell', resource: 'git push *', effect: 'deny' },
  ])

  // formatters
  config = setNested(config, ['formatter', 'prettier', 'disabled'], false)
  config = setNested(config, ['formatter', 'prettier', 'command'], ['prettier', '--write', '$FILE'])
  config = setNested(config, ['formatter', 'prettier', 'extensions'], ['.ts'])
  config = setNested(config, ['formatter', 'prettier', 'environment'], { NODE_ENV: 'production' })

  // lsp
  config = setNested(config, ['lsp', 'eslint', 'disabled'], true)
  config = setNested(config, ['lsp', 'custom', 'command'], ['eslint', '--stdio'])
  config = setNested(config, ['lsp', 'custom', 'extensions'], ['.ts'])
  config = setNested(config, ['lsp', 'custom', 'env'], { A: '1' })
  config = setNested(config, ['lsp', 'custom', 'initialization'], { a: 1 })
  config = setNested(config, ['lsp', 'custom', 'disabled'], false)

  // media
  config = setNested(config, ['media', 'image', 'auto_resize'], true)
  config = setNested(config, ['media', 'image', 'max_width'], 2000)
  config = setNested(config, ['media', 'image', 'max_height'], 2000)
  config = setNested(config, ['media', 'image', 'max_base64_bytes'], 5242880)

  // runtime
  config = setNested(config, ['tool_output', 'max_lines'], 2000)
  config = setNested(config, ['tool_output', 'max_bytes'], 51200)
  config = setNested(config, ['compaction', 'auto'], true)
  config = setNested(config, ['compaction', 'keep', 'tokens'], 1000)
  config = setNested(config, ['compaction', 'buffer'], 500)
  config = setNested(config, ['watcher', 'ignore'], ['node_modules/**'])
  config = setRoot(config, 'websearch', { provider: 'random' })
  config = setNested(config, ['worktree', 'directory'], '.worktrees')
  config = setRoot(config, 'warming', { prompt: 'warm up the project', interval: '4 minutes', duration: '30 minutes' })

  // experimental
  config = setNested(config, ['experimental', 'portable_shell_scanner'], true)
  config = setNested(config, ['experimental', 'subagent_depth'], 2)
  config = setNested(config, ['experimental', 'policies'], [
    { action: 'provider.use', resource: 'anthropic/*', effect: 'allow' },
  ])

  return config
}

const fixture = buildFixture()
const hasKey = (value: unknown, key: string) => isRecord(value) && Object.prototype.hasOwnProperty.call(value, key)

describe('config editor v2 output shape', () => {
  it('only produces known v2 top-level keys', () => {
    const unknown = Object.keys(fixture).filter(key => !KNOWN_ROOT_KEYS.has(key))

    expect(unknown).toEqual([])
  })

  it('passes local validation for every section', () => {
    expect(validateConfig(fixture, 'en')).toEqual([])
    expect(validateConfig(fixture, 'zh')).toEqual([])
  })

  it('writes renamed v1 keys nowhere in the tree', () => {
    // 顶层：v1 的单数/别名键都不该出现
    for (const legacy of [
      'provider',
      'agent',
      'command',
      'plugin',
      'attachment',
      'autoupdate',
      'autoshare',
      'snapshot',
      'reference',
      'skill',
      'server',
      'tools',
      'permission',
      'small_model',
      'subagent_depth',
      'logLevel',
      'layout',
      'mode',
    ]) {
      expect(hasKey(fixture, legacy), `top-level ${legacy}`).toBe(false)
    }

    // plugins：tuple 变 { package, options }，不再是 { name }
    const pluginObject = (fixture.plugins as unknown[])[1]
    expect(hasKey(pluginObject, 'package')).toBe(true)
    expect(hasKey(pluginObject, 'name')).toBe(false)

    // providers：npm -> package，api/options -> settings|headers|body
    const provider = fixture.providers!['openai'] as Record<string, unknown>
    expect(hasKey(provider, 'package')).toBe(true)
    for (const legacy of ['npm', 'api', 'options', 'id', 'whitelist', 'blacklist']) {
      expect(hasKey(provider, legacy), `provider ${legacy}`).toBe(false)
    }

    // model：删掉的字段不应该回来写
    const model = (provider.models as Record<string, Record<string, unknown>>)['gpt-4']
    for (const legacy of ['release_date', 'attachment', 'reasoning', 'temperature', 'status', 'experimental']) {
      expect(hasKey(model, legacy), `model ${legacy}`).toBe(false)
    }

    // agents：prompt -> system，disable -> disabled，maxSteps -> steps，variant 进 model
    const agent = fixture.agents!['build'] as Record<string, unknown>
    expect(hasKey(agent, 'system')).toBe(true)
    expect(hasKey(agent, 'steps')).toBe(true)
    for (const legacy of ['prompt', 'disable', 'maxSteps', 'variant', 'temperature', 'top_p']) {
      expect(hasKey(agent, legacy), `agent ${legacy}`).toBe(false)
    }

    // mcp：enabled -> disabled，OAuth 字段改 snake_case
    const remote = (fixture.mcp!.servers as Record<string, Record<string, unknown>>)['remote1']
    expect(hasKey(remote, 'disabled')).toBe(true)
    expect(hasKey(remote, 'enabled')).toBe(false)
    const oauth = remote.oauth as Record<string, unknown>
    expect(hasKey(oauth, 'client_id')).toBe(true)
    for (const legacy of ['clientId', 'clientSecret', 'callbackPort', 'redirectUri', 'authServerMetadataUrl']) {
      expect(hasKey(oauth, legacy), `oauth ${legacy}`).toBe(false)
    }

    // compaction：preserve_recent_tokens -> keep.tokens，reserved -> buffer
    const compaction = fixture.compaction as Record<string, unknown>
    expect(hasKey(compaction, 'keep')).toBe(true)
    expect(hasKey(compaction, 'buffer')).toBe(true)
    for (const legacy of ['preserve_recent_tokens', 'reserved', 'tail_turns', 'prune']) {
      expect(hasKey(compaction, legacy), `compaction ${legacy}`).toBe(false)
    }
  })

  it('stays valid after clearing optional sections', () => {
    const cleared = unsetRoot(unsetRoot(fixture, 'media'), 'plugins')

    expect(hasKey(cleared, 'media')).toBe(false)
    expect(hasKey(cleared, 'plugins')).toBe(false)
    expect(validateConfig(cleared, 'en')).toEqual([])
  })

  it('still rejects invalid values, so the fixture really goes through the validator', () => {
    expect(validateConfig(setRoot(fixture, 'update', 'sometimes'), 'en').map(error => error.path)).toContain('update')
    expect(
      validateConfig(setNested(fixture, ['mcp', 'servers', 'local1', 'type'], 'bogus'), 'en').map(error => error.path),
    ).toContain('mcp.servers.local1.type')
  })
})

/**
 * 可选：拿官方线上 schema 再验一遍。
 *
 * 默认跳过，因为要联网（`https://opencode.ai/config.json`）。
 * 手动跑：
 *   VITE_OCUI_OFFICIAL_SCHEMA=1 npx vitest run src/features/settings/components/configEditorShape.test.ts
 *
 * 注意：线上那份 schema 是 v1 + v2 并存的超集，所以它能抓类型/枚举/必填，
 * 但抓不出代际键名混用——后者由上面本地那份测试负责。
 */
const CHECK_OFFICIAL_SCHEMA = import.meta.env.VITE_OCUI_OFFICIAL_SCHEMA === '1'

describe('config editor output vs official schema', () => {
  it.skipIf(!CHECK_OFFICIAL_SCHEMA)(
    'is accepted by https://opencode.ai/config.json',
    async () => {
      const { default: Ajv2020 } = await import('ajv/dist/2020')
      const response = await fetch('https://opencode.ai/config.json', { signal: AbortSignal.timeout(20000) })
      expect(response.ok).toBe(true)
      const schema = (await response.json()) as object
      const ajv = new Ajv2020({ allErrors: true, strict: false })
      ajv.addSchema({ $id: 'https://models.dev/model-schema.json', $defs: { Model: { type: 'string' } } })
      const validate = ajv.compile(schema)

      expect(validate(fixture), JSON.stringify(validate.errors ?? [], null, 2)).toBe(true)
    },
    30000,
  )
})
