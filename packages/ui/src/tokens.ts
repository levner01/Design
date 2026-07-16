/**
 * DesignWan Design Token 骨架。
 * 真实主题与暗色模式由后续卡填充。
 */
export const DESIGN_TOKENS = {
  color: {
    bg: '#ffffff',
    fg: '#1a1a1a',
    accent: '#3b82f6',
    danger: '#dc2626',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 16,
    lg: 24,
  },
} as const;

export type DesignTokens = typeof DESIGN_TOKENS;
