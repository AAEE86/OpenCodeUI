import { useTranslation } from 'react-i18next'
import { Dialog } from './ui'
import { DiffView } from './DiffView'

// ============================================
// EditConfirmDialog — 保存 / 放弃改动的二次确认（需求三）
//
// 为什么不自己画 diff：工具调用卡片里的 `DiffView` 才是项目里 diff 的标准形态
// —— 自带文件名、+/- 统计、折叠、**全屏**，把它搬进来就不用再维持第二套观感。
//
// 误触一次就会写盘或丢改动，所以两条路都要先看一眼 diff；确认键**不做默认
// 聚焦**（Enter 不会直接落盘），Esc = 取消。
// ============================================

/** 超过这个体量就不渲染 diff（避免弹层卡死），只给摘要 */
const MAX_DIFF_CHARS = 200_000
/** diff 区高度上限：够看，又不至于把动作按钮挤出屏幕 */
const DIFF_MAX_HEIGHT = 520

export interface EditConfirmDialogProps {
  isOpen: boolean
  mode: 'save' | 'discard'
  fileName: string
  /** diff 前：保存 = 磁盘当前内容；放弃 = 我的草稿 */
  before: string
  /** diff 后：保存 = 我的草稿；放弃 = 磁盘当前内容 */
  after: string
  language?: string
  /** 保存时的冲突标记（磁盘已被别人改过） */
  conflict?: boolean
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function EditConfirmDialog({
  isOpen,
  mode,
  fileName,
  before,
  after,
  language = 'text',
  conflict = false,
  busy = false,
  onConfirm,
  onCancel,
}: EditConfirmDialogProps) {
  const { t } = useTranslation(['components', 'common'])
  const tooLarge = before.length + after.length > MAX_DIFF_CHARS

  const title =
    mode === 'save'
      ? t('fileExplorer.confirmSaveTitle', { name: fileName })
      : t('fileExplorer.confirmDiscardTitle', { name: fileName })

  return (
    <Dialog isOpen={isOpen} onClose={onCancel} title={title} width="min(92vw, 960px)" ariaLabel={title}>
      <div className="flex flex-col gap-3" data-testid="edit-confirm-dialog">
        {mode === 'save' && conflict && (
          <p className="text-[length:var(--fs-sm)] text-danger-100" data-testid="edit-confirm-conflict">
            {t('fileExplorer.confirmSaveConflict')}
          </p>
        )}
        <p className="text-[length:var(--fs-sm)] text-text-400">
          {mode === 'save' ? t('fileExplorer.confirmSaveHint') : t('fileExplorer.confirmDiscardHint')}
        </p>

        {tooLarge ? (
          <p className="text-[length:var(--fs-xs)] text-text-500">{t('fileExplorer.confirmDiffTooLarge')}</p>
        ) : (
          // 与工具卡片同一个组件：头部有文件名 / +/- 统计 / 全屏按钮
          <div data-testid="edit-confirm-diff">
            <DiffView
              before={before}
              after={after}
              filePath={fileName}
              language={language}
              maxHeight={DIFF_MAX_HEIGHT}
            />
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1.5 rounded-lg text-[length:var(--fs-sm)] text-text-300 hover:bg-bg-200 transition-colors disabled:opacity-50"
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            // 刻意不自动聚焦：避免 Enter 直接写盘 / 丢改动
            autoFocus={false}
            onClick={onConfirm}
            disabled={busy}
            className={`px-3 py-1.5 rounded-lg text-[length:var(--fs-sm)] font-medium transition-colors disabled:opacity-50 ${
              mode === 'save'
                ? 'bg-text-100 text-bg-000 hover:bg-text-200'
                : 'bg-danger-100 text-oncolor-100 hover:bg-danger-200'
            }`}
          >
            {mode === 'save'
              ? conflict
                ? t('fileExplorer.overwrite')
                : t('fileExplorer.confirmSaveAction')
              : t('fileExplorer.discardAction')}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
