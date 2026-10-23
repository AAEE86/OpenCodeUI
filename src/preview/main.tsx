import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import '../index.css'
import i18n from '../i18n'
import { themeStore } from '../store/themeStore'
import { FullscreenProvider } from '../contexts'
import { TimelinePreview } from './TimelinePreview'

// 与 src/main.tsx 相同：React 渲染前先把主题 CSS 变量注入
themeStore.init()

// 方便直接分享审查链接：?theme=light|dark&lang=zh|en
const params = new URLSearchParams(window.location.search)
const themeParam = params.get('theme')
if (themeParam === 'light' || themeParam === 'dark') themeStore.setColorMode(themeParam)
const langParam = params.get('lang')
if (langParam === 'zh') void i18n.changeLanguage('zh-CN')
if (langParam === 'en') void i18n.changeLanguage('en')

// 生产入口把 html/body/#root 锁成 100dvh + overflow hidden（聊天区自己滚）。
// 预览页是普通长文档，这里放开滚动。
for (const element of [document.documentElement, document.body, document.getElementById('root')]) {
  if (!element) continue
  element.style.height = 'auto'
  element.style.overflow = 'visible'
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FullscreenProvider>
      <TimelinePreview />
    </FullscreenProvider>
  </StrictMode>,
)
