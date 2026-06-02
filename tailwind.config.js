/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './renderer/app/**/*.{ts,tsx}',
    './renderer/components/**/*.{ts,tsx}',
    './renderer/lib/**/*.{ts,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--canvas) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        sunken: 'rgb(var(--sunken) / <alpha-value>)',
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        subtle: 'rgb(var(--subtle) / <alpha-value>)',
        edge: 'rgb(var(--edge) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        success: 'rgb(var(--success) / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        // Single font family across the whole app — UI sans, UI mono, and
        // the embedded xterm all render in JetBrains Mono. Falls back to
        // SF Mono → Menlo if JetBrains Mono is not installed.
        sans: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
        mono: ['JetBrains Mono', 'SF Mono', 'Menlo', 'monospace'],
      },
      fontSize: {
        xs: ['12px', '17px'],
        sm: ['13px', '19px'],
        base: ['14px', '21px'],
        lg: ['16px', '24px'],
      },
      keyframes: {
        // A short ±1px nudge with a long rest between — a gentle "needs you"
        // jitter, not a constant buzz.
        shake: {
          '0%, 72%, 100%': { transform: 'translateX(0)' },
          '78%': { transform: 'translateX(-1.2px)' },
          '84%': { transform: 'translateX(1.2px)' },
          '90%': { transform: 'translateX(-1.2px)' },
          '96%': { transform: 'translateX(1.2px)' },
        },
      },
      animation: {
        shake: 'shake 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
