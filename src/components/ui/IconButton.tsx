import { forwardRef } from 'react'

type IconButtonSize = 'sm' | 'md' | 'lg'
type IconButtonVariant = 'ghost' | 'solid'

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize
  variant?: IconButtonVariant
  /** 圆形按钮（发送/停止等主操作），默认圆角方形 */
  round?: boolean
  'aria-label': string
  children: React.ReactNode
}

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-8 w-8',
  lg: 'h-10 w-10',
}

const variantStyles: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent hover:bg-bg-200 text-text-400 hover:text-text-200',
  solid: 'bg-accent-main-000 hover:bg-accent-main-200 text-oncolor-100',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', variant = 'ghost', round = false, className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled}
        data-ui-button={variant === 'solid' ? 'primary' : 'ghost'}
        className={`
          inline-flex items-center justify-center
          ${round ? 'rounded-full' : 'rounded-lg'}
          transition-all duration-150
          active:scale-90
          disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100
          ${sizeStyles[size]}
          ${variantStyles[variant]}
          ${className}
        `}
        {...props}
      >
        {children}
      </button>
    )
  },
)

IconButton.displayName = 'IconButton'
