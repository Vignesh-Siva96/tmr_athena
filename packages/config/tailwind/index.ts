import type { Config } from 'tailwindcss'

const config: Omit<Config, 'content'> = {
  theme: {
    extend: {
      fontFamily: {
        sans: ['Geist', 'DM Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      colors: {
        // Portal tokens
        'p-bg': 'var(--p-bg)',
        'p-surface': 'var(--p-surface)',
        'p-surface-2': 'var(--p-surface-2)',
        'p-border': 'var(--p-border)',
        'p-border-2': 'var(--p-border-2)',
        'p-text': 'var(--p-text)',
        'p-text-2': 'var(--p-text-2)',
        'p-text-3': 'var(--p-text-3)',
        'p-text-4': 'var(--p-text-4)',
        'p-accent': 'var(--p-accent)',
        'p-accent-hv': 'var(--p-accent-hv)',
        'p-accent-bg': 'var(--p-accent-bg)',
        'p-success': 'var(--p-success)',
        'p-success-bg': 'var(--p-success-bg)',
        'p-warning': 'var(--p-warning)',
        'p-warning-bg': 'var(--p-warning-bg)',
        'p-danger': 'var(--p-danger)',
        'p-danger-bg': 'var(--p-danger-bg)',
        'p-purple': 'var(--p-purple)',
        'p-purple-bg': 'var(--p-purple-bg)',
        // Dashboard tokens
        'd-bg': 'var(--d-bg)',
        'd-surface': 'var(--d-surface)',
        'd-raised': 'var(--d-raised)',
        'd-raised-2': 'var(--d-raised-2)',
        'd-border': 'var(--d-border)',
        'd-border-2': 'var(--d-border-2)',
        'd-text': 'var(--d-text)',
        'd-text-2': 'var(--d-text-2)',
        'd-text-3': 'var(--d-text-3)',
        'd-text-4': 'var(--d-text-4)',
        'd-accent': 'var(--d-accent)',
        'd-accent-hv': 'var(--d-accent-hv)',
        'd-accent-bg': 'var(--d-accent-bg)',
        'd-success': 'var(--d-success)',
        'd-success-bg': 'var(--d-success-bg)',
        'd-warning': 'var(--d-warning)',
        'd-warning-bg': 'var(--d-warning-bg)',
        'd-danger': 'var(--d-danger)',
        'd-danger-bg': 'var(--d-danger-bg)',
        'd-purple': 'var(--d-purple)',
        'd-purple-bg': 'var(--d-purple-bg)',
        'd-note-bg': 'var(--d-note-bg)',
        'd-note-line': 'var(--d-note-line)',
      },
      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
      },
    },
  },
  plugins: [],
}

export default config
