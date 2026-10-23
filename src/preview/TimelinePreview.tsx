// ============================================
// Timeline UI Preview（仅 dev）
//
// 打开方式：npm run dev 后访问 /preview.html
// 这里只做一件事：用**生产组件本身**铺一页，方便直接看渲染效果。
// 不接后端、不写 session，fake 数据只存在于这个页面。
// ============================================

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { FileDiff } from '../api/types'
import { MessageRenderer } from '../features/message/MessageRenderer'
import {
  CompactionPartView,
  CompactionQueuedView,
  TimelineNoticeView,
  TurnDiffPartView,
  type NoticeMessage,
} from '../features/message/parts'
import { useTheme } from '../hooks/useTheme'
import type { SessionMessageCompaction, SessionMessageInfo } from '@opencode/client/promise'

const NOW = Date.now()

function textAssistant(id: string, text: string, createdOffset: number, completedOffset: number): SessionMessageInfo {
  return {
    id,
    type: 'assistant',
    agent: 'build',
    model: { providerID: 'anthropic', id: 'claude-sonnet-4-5' },
    content: [{ type: 'text', text }],
    time: { created: NOW + createdOffset, completed: NOW + completedOffset },
  }
}

const userMessage: SessionMessageInfo = {
  id: 'preview-user',
  type: 'user',
  text: '帮我把时间线里的会话事件提示改成和压缩一样的分隔线，并且默认关闭。',
  time: { created: NOW - 60_000 },
}

const assistantMessage = textAssistant(
  'preview-assistant',
  '已经改成左右横线 + 中间标签的分隔行。长路径会截断，悬停可以看完整内容。',
  -59_000,
  -58_000,
)

const agentSwitched: NoticeMessage = {
  id: 'preview-agent-switched',
  type: 'agent-switched',
  agent: 'plan',
  previous: 'build',
  time: { created: NOW - 59_500 },
}

const modelSwitched: NoticeMessage = {
  id: 'preview-model-switched',
  type: 'model-switched',
  model: { providerID: 'anthropic', id: 'claude-sonnet-4-5', variant: 'high' },
  time: { created: NOW - 58_500 },
}

const moveNotice: NoticeMessage = {
  id: 'preview-location',
  type: 'location-switched',
  location: {
    directory: 'E:/dev/re_agent_UI/OpenCodeUI-worktrees/feature/timeline-notices-looks-and-settings',
  },
  time: { created: NOW - 58_000 },
}

const skillNotice: NoticeMessage = {
  id: 'preview-skill',
  type: 'skill',
  skill: 'commit',
  name: 'Commit',
  text: '',
  time: { created: NOW - 57_000 },
}

const systemNotice: NoticeMessage = {
  id: 'preview-system',
  type: 'system',
  text: 'Instructions updated',
  description: 'Instructions updated: AGENTS.md, docs/v2-migration-contract.md, docs-ui-api-usage.md',
  metadata: {
    notice: 'instructions',
    instructionSources: ['AGENTS.md', 'docs/v2-migration-contract.md', 'docs-ui-api-usage.md'],
  },
  time: { created: NOW - 56_000 },
}

const subagentFailed: NoticeMessage = {
  id: 'preview-subagent',
  type: 'synthetic',
  text: 'Explore failed',
  description: 'Error: connect ETIMEDOUT 127.0.0.1:7890',
  metadata: { source: 'subagent', agent: 'explore', state: 'error' },
  time: { created: NOW - 55_000 },
}

const restartNotice: NoticeMessage = {
  id: 'preview-restart',
  type: 'synthetic',
  text: 'Continuing after restart',
  metadata: { notice: 'restart' },
  time: { created: NOW - 54_000 },
}

const genericSynthetic: NoticeMessage = {
  id: 'preview-synthetic',
  type: 'synthetic',
  text: 'Model switched while the turn was running; continuing from the previous step.',
  time: { created: NOW - 53_000 },
}

const noticeSamples: Array<{ caption: string; message: NoticeMessage }> = [
  { caption: 'agent 切换', message: agentSwitched },
  { caption: '模型切换（含 variant）', message: modelSwitched },
  { caption: '会话移动到 worktree（长路径截断）', message: moveNotice },
  { caption: '技能激活', message: skillNotice },
  { caption: '指令更新', message: systemNotice },
  { caption: '子任务失败', message: subagentFailed },
  { caption: '重启后继续', message: restartNotice },
  { caption: '普通 synthetic 文本', message: genericSynthetic },
]

const previewDiffs: FileDiff[] = [
  {
    file: 'src/features/message/parts/NoticePartView.tsx',
    status: 'modified',
    additions: 12,
    deletions: 6,
    patch: [
      '--- a/NoticePartView.tsx',
      '+++ b/NoticePartView.tsx',
      '@@ -1,4 +1,4 @@',
      '-import { NoticeSeparator } from "./NoticeSeparator"',
      '+import { TimelineSeparator } from "./SystemPartViews"',
      ' ',
      '-return <NoticeSeparator label={label} />',
      '+return <TimelineSeparator label={label} />',
      ' ',
    ].join('\n'),
  },
  {
    file: 'src/features/chat/chatAreaVisibility.ts',
    status: 'modified',
    additions: 8,
    deletions: 2,
    patch: [
      '--- a/chatAreaVisibility.ts',
      '+++ b/chatAreaVisibility.ts',
      '@@ -62,3 +62,5 @@',
      ' function hasAnyContent(message, showNotices) {',
      '-  if (isNoticeMessage(message)) return true',
      '+  if (showNotices && isNoticeMessage(message)) return true',
      '+  // 默认关闭时提示行不进时间线',
      '   return false',
      ' }',
    ].join('\n'),
  },
  {
    file: 'src/locales/zh-CN/message.json',
    status: 'modified',
    additions: 3,
    deletions: 0,
    patch: [
      '--- a/message.json',
      '+++ b/message.json',
      '@@ -115,2 +115,5 @@',
      '   "notice": {',
      '+    "skillActivated": "技能 · {{name}}",',
      '+    "movedTo": "会话已移动到 {{directory}}",',
      '+    "agentChangedDetail": "Agent 已切换 · {{previous}} → {{agent}}",',
      '   }',
    ].join('\n'),
  },
]

const runningCompaction: SessionMessageCompaction = {
  id: 'preview-compaction-running',
  type: 'compaction',
  status: 'running',
  reason: 'manual',
  summary: '正在整理前 40 轮对话…',
  recent: '',
  time: { created: NOW - 52_000 },
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-[15px] font-medium text-text-100">{title}</h2>
        {description && <p className="text-[12px] leading-relaxed text-text-500">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function ToolbarButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
        active
          ? 'border-accent-main-100/40 bg-accent-main-100/10 text-accent-main-100'
          : 'border-border-200/70 text-text-400 hover:text-text-200'
      }`}
    >
      {children}
    </button>
  )
}

export function TimelinePreview() {
  const { t, i18n } = useTranslation(['message', 'settings'])
  const { mode, setTheme } = useTheme()

  return (
    <div className="min-h-screen bg-bg-100 pb-24 text-text-100">
      <div className="mx-auto w-full max-w-3xl px-5 pt-10">
        <div className="mb-8 space-y-3 border-b border-border-200/60 pb-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-[20px] font-semibold">Timeline UI Preview</h1>
              <p className="text-[12px] text-text-500">
                仅开发环境。下面全部是生产组件本身，不走 mock 组件。正式入口里三项都默认关闭。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <ToolbarButton active={i18n.language.startsWith('zh')} onClick={() => void i18n.changeLanguage('zh-CN')}>
                中文
              </ToolbarButton>
              <ToolbarButton active={!i18n.language.startsWith('zh')} onClick={() => void i18n.changeLanguage('en')}>
                English
              </ToolbarButton>
              <span className="mx-1 h-4 w-px bg-border-200/70" />
              <ToolbarButton active={mode === 'light'} onClick={() => setTheme('light')}>
                浅色
              </ToolbarButton>
              <ToolbarButton active={mode === 'dark'} onClick={() => setTheme('dark')}>
                深色
              </ToolbarButton>
              <ToolbarButton active={mode === 'system'} onClick={() => setTheme('system')}>
                跟随系统
              </ToolbarButton>
            </div>
          </div>
        </div>

        <div className="space-y-10">
          <Section
            title="分隔行：会话事件提示"
            description="设置 → Agent → 行为 →「显示会话事件提示」。默认关闭。长文本截断，悬停看完整内容。"
          >
            <div className="divide-y divide-border-200/40 rounded-lg border border-border-200/60">
              {noticeSamples.map(sample => (
                <div key={sample.message.id} className="flex flex-col gap-1 px-1 py-2">
                  <div className="px-3 text-[11px] text-text-500">{sample.caption}</div>
                  <TimelineNoticeView message={sample.message} />
                </div>
              ))}
              <div className="flex flex-col gap-1 px-1 py-2">
                <div className="px-3 text-[11px] text-text-500">压缩排队</div>
                <CompactionQueuedView />
              </div>
            </div>
          </Section>

          <Section
            title="压缩：排队 / 进行中"
            description="排队提示与压缩中的分隔线对比。设置 → Agent → 行为 →「显示压缩排队提示」。"
          >
            <div className="rounded-lg border border-border-200/60 px-2 py-3">
              <CompactionQueuedView />
              <CompactionPartView message={runningCompaction} />
            </div>
          </Section>

          <Section
            title="回合文件变更：收起 / 展开"
            description="设置 → Agent → 行为 →「显示回合文件变更」。默认关闭。展开后点文件可以看 diff。"
          >
            <div className="space-y-4 rounded-lg border border-border-200/60 p-2">
              <div className="space-y-1">
                <div className="px-2 text-[11px] text-text-500">默认：收起成一行</div>
                <TurnDiffPartView
                  sessionId={null}
                  from="preview-turn-collapsed"
                  files={previewDiffs.map(diff => diff.file)}
                  diffs={previewDiffs}
                  stateKey="preview-turn-diff-collapsed"
                />
              </div>
              <div className="space-y-1 border-t border-border-200/40 pt-3">
                <div className="px-2 text-[11px] text-text-500">展开：文件列表 + 点文件看 diff</div>
                <TurnDiffPartView
                  sessionId={null}
                  from="preview-turn-expanded"
                  files={previewDiffs.map(diff => diff.file)}
                  diffs={previewDiffs}
                  defaultExpanded
                  stateKey="preview-turn-diff-expanded"
                />
              </div>
            </div>
          </Section>

          <Section
            title="真实对话流里的位置"
            description="行距按 ChatArea 的 py 规则铺（user py-3 / assistant py-1 / 提示行 py-0），用来判断真实节奏。"
          >
            <div className="flex flex-col rounded-lg border border-border-200/60 px-3 py-5">
              <div className="py-3">
                <MessageRenderer message={userMessage} />
              </div>
              <TimelineNoticeView message={agentSwitched} />
              <div className="py-1">
                <MessageRenderer message={assistantMessage} />
              </div>
              <TimelineNoticeView message={modelSwitched} />
              <TimelineNoticeView message={systemNotice} />
              <div className="py-1">
                <TurnDiffPartView
                  sessionId={null}
                  from="preview-turn-inline"
                  files={previewDiffs.map(diff => diff.file)}
                  diffs={previewDiffs}
                  stateKey="preview-turn-diff-inline"
                />
              </div>
              <CompactionQueuedView />
              <div className="py-1">
                <MessageRenderer
                  message={textAssistant(
                    'preview-assistant-2',
                    '压缩完成后我会带着新的上下文继续。',
                    -50_000,
                    -49_000,
                  )}
                />
              </div>
            </div>
          </Section>

          <Section title="开关位置" description="正式入口在设置里，不在这个预览页。">
            <div className="space-y-2 rounded-lg border border-border-200/60 px-4 py-3 text-[12px] text-text-400">
              <div>{t('settings:chat.showTimelineNotices')}：默认关闭</div>
              <div>{t('settings:chat.showTurnDiff')}：默认关闭</div>
              <div>{t('settings:chat.showQueuedCompaction')}：默认关闭</div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  )
}
