import type { Config } from '../../../types/api/config'
import { POLICY_ACTIONS, POLICY_EFFECTS, PERMISSION_EFFECTS } from './configEditorMeta'
import { navigationForConfigSegments, sectionForConfigSegments } from './configEditorSearch'
import type { JsonRecord, SectionID } from './configEditorTypes'

export type ValidationError = { path: string; segments?: string[]; message: string }
export type ValidationDrillTarget = { section: SectionID; stack: { id: string; title: string }[]; key: string }

const MCP_PROTOCOLS = ['legacy', 'auto', '2026-07-28']
const AGENT_MODES = ['subagent', 'primary', 'all']
const ROOT_UPDATE = ['disable', 'notify', 'auto']
const ROOT_SHARE = ['manual', 'auto', 'disabled']

export function validateConfig(config: Config, lang: string, _original?: Config): ValidationError[] {
  const errors: ValidationError[] = []
  const root = config as JsonRecord
  const add = (path: string, en: string, zh: string, segments?: string[]) =>
    errors.push({ path, segments, message: tx(en, zh, lang) })
  const requireString = (path: string, value: unknown, segments?: string[]) => {
    if (typeof value !== 'string') add(path, 'must be a string', '必须是字符串', segments)
  }
  const requireBoolean = (path: string, value: unknown, segments?: string[]) => {
    if (typeof value !== 'boolean') add(path, 'must be a boolean', '必须是布尔值', segments)
  }
  const requireStringArray = (path: string, value: unknown, segments?: string[]) => {
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string'))
      add(path, 'must be an array of strings', '必须是字符串数组', segments)
  }
  const requireStringMap = (path: string, value: unknown, segments?: string[]) => {
    if (!isRecord(value) || Object.values(value).some(item => typeof item !== 'string'))
      add(path, 'must be an object with string values', '必须是字符串值对象', segments)
  }
  const requireRecord = (path: string, value: unknown, segments?: string[]) => {
    if (!isRecord(value)) add(path, 'must be an object', '必须是对象', segments)
  }
  const requireModelSelection = (path: string, value: unknown, segments?: string[]) => {
    if (typeof value === 'string') {
      if (!/^[^/#]+\/[^#]+(?:#[^#]+)?$/u.test(value))
        add(path, 'must be "provider/model" or "provider/model#variant"', '必须是 "provider/model" 或 "provider/model#variant"', segments)
      return
    }
    if (!isRecord(value)) {
      add(path, 'must be a string or a { providerID, model } object', '必须是字符串或 { providerID, model } 对象', segments)
      return
    }
    if (typeof value.providerID !== 'string' || !value.providerID)
      add(`${path}.providerID`, 'must be a non-empty string', '必须是非空字符串', segments ? [...segments, 'providerID'] : undefined)
    if (typeof value.model !== 'string' || !value.model)
      add(`${path}.model`, 'must be a non-empty string', '必须是非空字符串', segments ? [...segments, 'model'] : undefined)
    if (value.variant !== undefined && typeof value.variant !== 'string')
      add(`${path}.variant`, 'must be a string', '必须是字符串', segments ? [...segments, 'variant'] : undefined)
  }

  // ---- 顶层标量 ----
  if (root.shell !== undefined) requireString('shell', root.shell, ['shell'])
  if (root.default_agent !== undefined) requireString('default_agent', root.default_agent, ['default_agent'])
  if (root.username !== undefined) requireString('username', root.username, ['username'])
  if (root.$schema !== undefined) requireString('$schema', root.$schema, ['$schema'])
  if (root.model !== undefined) requireModelSelection('model', root.model, ['model'])
  if (root.snapshots !== undefined) requireBoolean('snapshots', root.snapshots, ['snapshots'])
  if (root.update !== undefined && !ROOT_UPDATE.includes(String(root.update)))
    add('update', 'must be disable, notify, or auto', '必须是 disable、notify 或 auto', ['update'])
  if (root.share !== undefined && !ROOT_SHARE.includes(String(root.share)))
    add('share', 'must be manual, auto, or disabled', '必须是 manual、auto 或 disabled', ['share'])
  if (root.instructions !== undefined) requireStringArray('instructions', root.instructions, ['instructions'])
  if (root.skills !== undefined) requireStringArray('skills', root.skills, ['skills'])

  if (root.enterprise !== undefined) {
    requireRecord('enterprise', root.enterprise, ['enterprise'])
    const enterprise = getObject(root, 'enterprise')
    if (enterprise.url !== undefined) requireString('enterprise.url', enterprise.url, ['enterprise', 'url'])
  }

  if (root.references !== undefined) {
    requireRecord('references', root.references, ['references'])
    for (const [alias, entry] of Object.entries(getObject(root, 'references'))) {
      const path = ['references', alias]
      if (typeof entry === 'string') continue
      if (!isRecord(entry)) {
        add(`references.${alias}`, 'must be a string, a git reference or a local path', '必须是字符串、git 引用或本地路径', path)
        continue
      }
      if ('path' in entry) requireString(`references.${alias}.path`, entry.path, [...path, 'path'])
      else requireString(`references.${alias}.repository`, entry.repository, [...path, 'repository'])
      if (entry.branch !== undefined) requireString(`references.${alias}.branch`, entry.branch, [...path, 'branch'])
      if (entry.description !== undefined) requireString(`references.${alias}.description`, entry.description, [...path, 'description'])
      if (entry.hidden !== undefined) requireBoolean(`references.${alias}.hidden`, entry.hidden, [...path, 'hidden'])
    }
  }

  // ---- commands ----
  for (const [commandID, commandValue] of Object.entries(getObject(root, 'commands'))) {
    const command = isRecord(commandValue) ? commandValue : {}
    const path = ['commands', commandID]
    if (typeof command.template !== 'string')
      add(`commands.${commandID}.template`, 'must be a string', '必须是字符串', [...path, 'template'])
    if (command.description !== undefined) requireString(`commands.${commandID}.description`, command.description, [...path, 'description'])
    if (command.agent !== undefined) requireString(`commands.${commandID}.agent`, command.agent, [...path, 'agent'])
    if (command.model !== undefined) requireModelSelection(`commands.${commandID}.model`, command.model, [...path, 'model'])
    if (command.subagent !== undefined) requireBoolean(`commands.${commandID}.subagent`, command.subagent, [...path, 'subagent'])
    if (command.subtask !== undefined) requireBoolean(`commands.${commandID}.subtask`, command.subtask, [...path, 'subtask'])
  }

  // ---- agents ----
  for (const [name, agentValue] of Object.entries(getObject(root, 'agents'))) {
    const agent = isRecord(agentValue) ? agentValue : {}
    const path = ['agents', name]
    if (agent.model !== undefined) requireModelSelection(`agents.${name}.model`, agent.model, [...path, 'model'])
    if (agent.system !== undefined) requireString(`agents.${name}.system`, agent.system, [...path, 'system'])
    if (agent.description !== undefined) requireString(`agents.${name}.description`, agent.description, [...path, 'description'])
    if (agent.mode !== undefined && !AGENT_MODES.includes(String(agent.mode)))
      add(`agents.${name}.mode`, 'must be primary, subagent, or all', '必须是 primary、subagent 或 all', [...path, 'mode'])
    if (agent.hidden !== undefined) requireBoolean(`agents.${name}.hidden`, agent.hidden, [...path, 'hidden'])
    if (agent.disabled !== undefined) requireBoolean(`agents.${name}.disabled`, agent.disabled, [...path, 'disabled'])
    if (agent.color !== undefined && !/^#[0-9a-fA-F]{6}$/u.test(String(agent.color)))
      add(`agents.${name}.color`, 'must be a #RRGGBB color', '必须是 #RRGGBB 颜色', [...path, 'color'])
    if (agent.steps !== undefined && !isPositiveInteger(agent.steps))
      add(`agents.${name}.steps`, 'must be a positive integer', '必须是正整数', [...path, 'steps'])
    if (agent.request !== undefined) {
      requireRecord(`agents.${name}.request`, agent.request, [...path, 'request'])
      const request = getObject(agent, 'request')
      if (request.headers !== undefined) requireStringMap(`agents.${name}.request.headers`, request.headers, [...path, 'request', 'headers'])
      if (request.body !== undefined) requireRecord(`agents.${name}.request.body`, request.body, [...path, 'request', 'body'])
    }
    if (agent.permissions !== undefined) validatePermissions(agent.permissions, [...path, 'permissions'], add)
  }

  // ---- providers ----
  for (const [providerID, providerValue] of Object.entries(getObject(root, 'providers'))) {
    const provider = isRecord(providerValue) ? providerValue : {}
    const path = ['providers', providerID]
    for (const key of ['canonical', 'name', 'package'])
      if (provider[key] !== undefined) requireString(`providers.${providerID}.${key}`, provider[key], [...path, key])
    if (provider.env !== undefined) requireStringArray(`providers.${providerID}.env`, provider.env, [...path, 'env'])
    if (provider.headers !== undefined) requireStringMap(`providers.${providerID}.headers`, provider.headers, [...path, 'headers'])
    if (provider.body !== undefined) requireRecord(`providers.${providerID}.body`, provider.body, [...path, 'body'])
    if (provider.settings !== undefined) validateProviderSettings(provider.settings, [...path, 'settings'], add)

    for (const [modelID, modelValue] of Object.entries(getObject(provider, 'models'))) {
      const model = isRecord(modelValue) ? modelValue : {}
      const modelPath = [...path, 'models', modelID]
      const pathString = `providers.${providerID}.models.${modelID}`
      for (const key of ['modelID', 'family', 'name', 'package'])
        if (model[key] !== undefined) requireString(`${pathString}.${key}`, model[key], [...modelPath, key])
      if (model.disabled !== undefined) requireBoolean(`${pathString}.disabled`, model.disabled, [...modelPath, 'disabled'])
      if (model.headers !== undefined) requireStringMap(`${pathString}.headers`, model.headers, [...modelPath, 'headers'])
      if (model.body !== undefined) requireRecord(`${pathString}.body`, model.body, [...modelPath, 'body'])
      if (model.settings !== undefined) requireRecord(`${pathString}.settings`, model.settings, [...modelPath, 'settings'])
      if (model.compatibility !== undefined) requireRecord(`${pathString}.compatibility`, model.compatibility, [...modelPath, 'compatibility'])
      if (model.capabilities !== undefined) {
        requireRecord(`${pathString}.capabilities`, model.capabilities, [...modelPath, 'capabilities'])
        const capabilities = getObject(model, 'capabilities')
        if (capabilities.tools !== undefined) requireBoolean(`${pathString}.capabilities.tools`, capabilities.tools, [...modelPath, 'capabilities', 'tools'])
        if (capabilities.input !== undefined) requireStringArray(`${pathString}.capabilities.input`, capabilities.input, [...modelPath, 'capabilities', 'input'])
        if (capabilities.output !== undefined) requireStringArray(`${pathString}.capabilities.output`, capabilities.output, [...modelPath, 'capabilities', 'output'])
      }
      if (model.variants !== undefined) {
        if (!Array.isArray(model.variants)) add(`${pathString}.variants`, 'must be an array', '必须是数组', [...modelPath, 'variants'])
        else
          model.variants.forEach((variantValue, index) => {
            const variantPath = [...modelPath, 'variants', String(index)]
            const variant = isRecord(variantValue) ? variantValue : {}
            if (typeof variant.id !== 'string' || !variant.id)
              add(`${pathString}.variants[${index}].id`, 'must be a non-empty string', '必须是非空字符串', [...variantPath, 'id'])
            if (variant.headers !== undefined) requireStringMap(`${pathString}.variants[${index}].headers`, variant.headers, [...variantPath, 'headers'])
            if (variant.body !== undefined) requireRecord(`${pathString}.variants[${index}].body`, variant.body, [...variantPath, 'body'])
            if (variant.settings !== undefined) requireRecord(`${pathString}.variants[${index}].settings`, variant.settings, [...variantPath, 'settings'])
          })
      }
      if (model.cost !== undefined) validateModelCost(model.cost, modelPath, `${pathString}.cost`, add)
      if (model.limit !== undefined) {
        requireRecord(`${pathString}.limit`, model.limit, [...modelPath, 'limit'])
        const limit = getObject(model, 'limit')
        for (const key of ['context', 'input', 'output'])
          if (limit[key] !== undefined && !isFiniteNumber(limit[key]))
            add(`${pathString}.limit.${key}`, 'must be a number', '必须是数字', [...modelPath, 'limit', key])
      }
    }
  }

  // ---- mcp ----
  const mcp = getObject(root, 'mcp')
  if (mcp.timeout !== undefined) validateMcpTimeout(mcp.timeout, ['mcp', 'timeout'], 'mcp.timeout', add)
  for (const [name, value] of Object.entries(getObject(mcp, 'servers'))) {
    const server = isRecord(value) ? value : {}
    const path = ['mcp', 'servers', name]
    const pathString = `mcp.servers.${name}`
    const type = server.type
    if (type === 'local') requireStringArray(`${pathString}.command`, server.command, [...path, 'command'])
    else if (type === 'remote') requireString(`${pathString}.url`, server.url, [...path, 'url'])
    else add(`${pathString}.type`, 'must be local or remote', '必须是 local 或 remote', [...path, 'type'])
    if (server.cwd !== undefined) requireString(`${pathString}.cwd`, server.cwd, [...path, 'cwd'])
    if (server.environment !== undefined) requireStringMap(`${pathString}.environment`, server.environment, [...path, 'environment'])
    if (server.headers !== undefined) requireStringMap(`${pathString}.headers`, server.headers, [...path, 'headers'])
    if (server.disabled !== undefined) requireBoolean(`${pathString}.disabled`, server.disabled, [...path, 'disabled'])
    if (server.codemode !== undefined) requireBoolean(`${pathString}.codemode`, server.codemode, [...path, 'codemode'])
    if (server.protocol !== undefined && !MCP_PROTOCOLS.includes(String(server.protocol)))
      add(`${pathString}.protocol`, 'must be legacy, auto, or 2026-07-28', '必须是 legacy、auto 或 2026-07-28', [...path, 'protocol'])
    if (server.timeout !== undefined) validateMcpTimeout(server.timeout, [...path, 'timeout'], `${pathString}.timeout`, add)
    if (server.oauth !== undefined && server.oauth !== false) {
      requireRecord(`${pathString}.oauth`, server.oauth, [...path, 'oauth'])
      const oauth = getObject(server, 'oauth')
      for (const key of ['client_id', 'client_secret', 'scope', 'redirect_uri', 'auth_server_metadata_url'])
        if (oauth[key] !== undefined) requireString(`${pathString}.oauth.${key}`, oauth[key], [...path, 'oauth', key])
      if (oauth.callback_port !== undefined && (!isPositiveInteger(oauth.callback_port) || Number(oauth.callback_port) > 65535))
        add(`${pathString}.oauth.callback_port`, 'must be an integer from 1 to 65535', '必须是 1 到 65535 的整数', [...path, 'oauth', 'callback_port'])
    }
  }

  // ---- permissions ----
  if (root.permissions !== undefined) validatePermissions(root.permissions, ['permissions'], add)

  // ---- formatter / lsp ----
  const formatter = root.formatter
  if (isRecord(formatter)) {
    for (const [name, value] of Object.entries(formatter)) {
      const entry = isRecord(value) ? value : {}
      const path = ['formatter', name]
      if (entry.disabled !== undefined) requireBoolean(`formatter.${name}.disabled`, entry.disabled, [...path, 'disabled'])
      if (entry.command !== undefined) requireStringArray(`formatter.${name}.command`, entry.command, [...path, 'command'])
      if (entry.extensions !== undefined) requireStringArray(`formatter.${name}.extensions`, entry.extensions, [...path, 'extensions'])
      if (entry.environment !== undefined) requireStringMap(`formatter.${name}.environment`, entry.environment, [...path, 'environment'])
    }
  }

  const lsp = root.lsp
  if (isRecord(lsp)) {
    for (const [name, value] of Object.entries(lsp)) {
      const entry = isRecord(value) ? value : {}
      const path = ['lsp', name]
      if (entry.disabled === true && !('command' in entry)) continue
      requireStringArray(`lsp.${name}.command`, entry.command, [...path, 'command'])
      if (entry.extensions !== undefined) requireStringArray(`lsp.${name}.extensions`, entry.extensions, [...path, 'extensions'])
      if (entry.env !== undefined) requireStringMap(`lsp.${name}.env`, entry.env, [...path, 'env'])
      if (entry.initialization !== undefined) requireRecord(`lsp.${name}.initialization`, entry.initialization, [...path, 'initialization'])
      if (entry.disabled !== undefined) requireBoolean(`lsp.${name}.disabled`, entry.disabled, [...path, 'disabled'])
    }
  }

  // ---- media / runtime ----
  const image = getObject(getObject(root, 'media'), 'image')
  for (const key of ['max_width', 'max_height', 'max_base64_bytes'])
    if (image[key] !== undefined && !isPositiveInteger(image[key]))
      add(`media.image.${key}`, 'must be a positive integer', '必须是正整数', ['media', 'image', key])
  if (image.auto_resize !== undefined) requireBoolean('media.image.auto_resize', image.auto_resize, ['media', 'image', 'auto_resize'])

  const toolOutput = getObject(root, 'tool_output')
  for (const key of ['max_lines', 'max_bytes'])
    if (toolOutput[key] !== undefined && !isPositiveInteger(toolOutput[key]))
      add(`tool_output.${key}`, 'must be a positive integer', '必须是正整数', ['tool_output', key])

  const compaction = getObject(root, 'compaction')
  if (compaction.auto !== undefined) requireBoolean('compaction.auto', compaction.auto, ['compaction', 'auto'])
  const keep = getObject(compaction, 'keep')
  if (keep.tokens !== undefined && !isNonNegativeInteger(keep.tokens))
    add('compaction.keep.tokens', 'must be a non-negative integer', '必须是非负整数', ['compaction', 'keep', 'tokens'])
  if (compaction.buffer !== undefined && !isNonNegativeInteger(compaction.buffer))
    add('compaction.buffer', 'must be a non-negative integer', '必须是非负整数', ['compaction', 'buffer'])

  const watcher = getObject(root, 'watcher')
  if (watcher.ignore !== undefined) requireStringArray('watcher.ignore', watcher.ignore, ['watcher', 'ignore'])

  const worktree = getObject(root, 'worktree')
  if (worktree.directory !== undefined && (typeof worktree.directory !== 'string' || worktree.directory.trim() === ''))
    add('worktree.directory', 'must be a non-empty string', '必须是非空字符串', ['worktree', 'directory'])

  if (root.websearch !== undefined && root.websearch !== false) {
    requireRecord('websearch', root.websearch, ['websearch'])
    const websearch = getObject(root, 'websearch')
    if (typeof websearch.provider !== 'string' || !websearch.provider)
      add('websearch.provider', 'must be a provider id or "random"', '必须是 provider id 或 "random"', ['websearch', 'provider'])
  }

  if (root.warming !== undefined && typeof root.warming !== 'boolean') {
    requireRecord('warming', root.warming, ['warming'])
    const warming = getObject(root, 'warming')
    for (const key of ['prompt', 'interval', 'duration'])
      if (warming[key] !== undefined) requireString(`warming.${key}`, warming[key], ['warming', key])
  }

  // ---- experimental ----
  const experimental = getObject(root, 'experimental')
  if (experimental.portable_shell_scanner !== undefined)
    requireBoolean('experimental.portable_shell_scanner', experimental.portable_shell_scanner, ['experimental', 'portable_shell_scanner'])
  if (experimental.subagent_depth !== undefined && !isNonNegativeInteger(experimental.subagent_depth))
    add('experimental.subagent_depth', 'must be a non-negative integer', '必须是非负整数', ['experimental', 'subagent_depth'])
  if (experimental.policies !== undefined) {
    if (!Array.isArray(experimental.policies))
      add('experimental.policies', 'must be an array', '必须是数组', ['experimental', 'policies'])
    else
      experimental.policies.forEach((policyValue, index) => {
        const policy = isRecord(policyValue) ? policyValue : {}
        const path = ['experimental', 'policies', String(index)]
        if (!POLICY_ACTIONS.includes(String(policy.action)))
          add(`experimental.policies[${index}].action`, 'must be a known policy action', '必须是已知的策略动作', [...path, 'action'])
        if (typeof policy.resource !== 'string' || !policy.resource)
          add(`experimental.policies[${index}].resource`, 'must be a non-empty string', '必须是非空字符串', [...path, 'resource'])
        if (!POLICY_EFFECTS.includes(String(policy.effect)))
          add(`experimental.policies[${index}].effect`, 'must be allow or deny', '必须是 allow 或 deny', [...path, 'effect'])
      })
  }

  return errors
}

function validatePermissions(value: unknown, segments: string[], add: AddError) {
  if (!Array.isArray(value)) {
    add(segments.join('.'), 'must be an array of rules', '必须是规则数组', segments)
    return
  }
  value.forEach((ruleValue, index) => {
    const rule = isRecord(ruleValue) ? ruleValue : {}
    const path = [...segments, String(index)]
    const pathString = `${segments.join('.')}[${index}]`
    if (typeof rule.action !== 'string' || !rule.action)
      add(`${pathString}.action`, 'must be a non-empty string', '必须是非空字符串', [...path, 'action'])
    if (typeof rule.resource !== 'string' || !rule.resource)
      add(`${pathString}.resource`, 'must be a non-empty string', '必须是非空字符串', [...path, 'resource'])
    if (!PERMISSION_EFFECTS.includes(String(rule.effect)))
      add(`${pathString}.effect`, 'must be allow, deny, or ask', '必须是 allow、deny 或 ask', [...path, 'effect'])
  })
}

function validateProviderSettings(value: unknown, segments: string[], add: AddError) {
  if (!isRecord(value)) {
    add(segments.join('.'), 'must be an object', '必须是对象', segments)
    return
  }
  for (const key of ['timeout', 'headerTimeout']) {
    const item = value[key]
    if (item !== undefined && item !== false && !isPositiveInteger(item))
      add(`${segments.join('.')}.${key}`, 'must be a positive integer or false', '必须是正整数或 false', [...segments, key])
  }
  if (value.chunkTimeout !== undefined && !isPositiveInteger(value.chunkTimeout))
    add(`${segments.join('.')}.chunkTimeout`, 'must be a positive integer', '必须是正整数', [...segments, 'chunkTimeout'])
}

function validateMcpTimeout(value: unknown, segments: string[], pathString: string, add: AddError) {
  if (!isRecord(value)) {
    add(pathString, 'must be an object', '必须是对象', segments)
    return
  }
  for (const key of ['startup', 'catalog', 'execution'])
    if (value[key] !== undefined && !isPositiveInteger(value[key]))
      add(`${pathString}.${key}`, 'must be a positive integer', '必须是正整数', [...segments, key])
}

function validateModelCost(value: unknown, modelPath: string[], pathString: string, add: AddError) {
  const costs = Array.isArray(value) ? value : [value]
  costs.forEach((costValue, index) => {
    const cost = isRecord(costValue) ? costValue : {}
    const path = Array.isArray(value) ? [...modelPath, 'cost', String(index)] : [...modelPath, 'cost']
    const suffix = Array.isArray(value) ? `[${index}]` : ''
    for (const key of ['input', 'output'])
      if (cost[key] === undefined) add(`${pathString}${suffix}.${key}`, 'is required', '必填', [...path, key])
      else if (!isFiniteNumber(cost[key])) add(`${pathString}${suffix}.${key}`, 'must be a number', '必须是数字', [...path, key])
    const cache = getObject(cost, 'cache')
    for (const key of ['read', 'write'])
      if (cache[key] !== undefined && !isFiniteNumber(cache[key]))
        add(`${pathString}${suffix}.cache.${key}`, 'must be a number', '必须是数字', [...path, 'cache', key])
    const tier = getObject(cost, 'tier')
    if (cost.tier !== undefined) {
      if (!isRecord(cost.tier) || String(tier.type) !== 'context' || !isFiniteNumber(tier.size))
        add(`${pathString}${suffix}.tier`, 'must be { type: "context", size }', '必须是 { type: "context", size }', [...path, 'tier'])
    }
  })
}

type AddError = (path: string, en: string, zh: string, segments?: string[]) => void

export function validationDrillTargetForError(error: ValidationError): Omit<ValidationDrillTarget, 'key'> {
  const segments = error.segments?.length ? error.segments : error.path === '$' ? [] : error.path.split('.')
  const navigation = navigationForConfigSegments(segments)
  return { section: navigation.section, stack: navigation.stack }
}

function sectionForValidationPath(path: string, segments: string[]): SectionID {
  return sectionForConfigSegments(segments.length ? segments : path.split('.'))
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getObject(record: unknown, key: string): JsonRecord {
  if (!isRecord(record)) return {}
  const value = record[key]
  return isRecord(value) ? value : {}
}

function isPositiveInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function isNonNegativeInteger(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
}

function tx(en: string, zh: string, lang: string) {
  return lang.startsWith('zh') ? zh : en
}

export { sectionForValidationPath }
