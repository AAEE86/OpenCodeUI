/**
 * 玻璃外观下的表面 token。
 *
 * 玻璃下不再使用主题的"表面色"，所有层次都是文字色的透明度叠加：
 * 越靠上的层叠得越亮。所以这里不再用主题的 bg-*-000 深灰，
 * 而是把 000/200/300/400 全部换成 content 的浅色叠加。
 * bg-100 由 glass.css 置空，由 .app-shell 统一涂一层。
 *
 * 浅色模式不做玻璃，直接回退到主题实色，避免整个界面被灰色冲淡。
 */

const SURFACE_TOKENS = ['--color-bg-000', '--color-bg-200', '--color-bg-300', '--color-bg-400'] as const

/** 深色下各层的 content 叠加强度（%），顺序对应 bg-000 → bg-400 */
const DARK_VEIL: Record<(typeof SURFACE_TOKENS)[number], number> = {
  '--color-bg-000': 8,
  '--color-bg-200': 6,
  '--color-bg-300': 4,
  '--color-bg-400': 2.5,
}

/** 浮层与输入框的底色：深色用极淡的 content，浅色用实色 */
const VEIL = 'color-mix(in srgb, hsl(var(--text-100)) 4%, transparent)'
const VEIL_SOFT = 'color-mix(in srgb, hsl(var(--text-100)) 2.5%, transparent)'

export const GLASS_TOKEN_KEYS: string[] = [
  ...SURFACE_TOKENS,
  '--glass-veil',
  '--glass-veil-soft',
  '--glass-alpha',
  '--glass-wallpaper',
  '--glass-wallpaper-fit',
  '--glass-art-alpha',
]

export function buildGlassTokens(isDark: boolean): Record<string, string> {
  const tokens: Record<string, string> = {}

  if (!isDark) {
    tokens['--color-bg-000'] = 'hsl(var(--bg-000))'
    tokens['--color-bg-200'] = 'hsl(var(--bg-200))'
    tokens['--color-bg-300'] = 'hsl(var(--bg-300))'
    tokens['--color-bg-400'] = 'hsl(var(--bg-400))'
    tokens['--glass-veil'] = 'hsl(var(--bg-000))'
    tokens['--glass-veil-soft'] = 'hsl(var(--bg-000))'
    return tokens
  }

  for (const key of SURFACE_TOKENS) {
    tokens[key] = `color-mix(in srgb, hsl(var(--text-100)) ${DARK_VEIL[key]}%, transparent)`
  }
  tokens['--glass-veil'] = VEIL
  tokens['--glass-veil-soft'] = VEIL_SOFT
  return tokens
}
