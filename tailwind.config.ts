import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      /**
       * Every colour resolves through a CSS variable holding an RGB triplet, so
       * a theme is just a block of variable overrides on <html data-theme="…"].
       * The <alpha-value> placeholder keeps Tailwind's opacity modifiers
       * (`bg-accent/10`, `border-line/40`) working against those variables.
       */
      colors: {
        stage: 'rgb(var(--stage-rgb) / <alpha-value>)',
        bg: 'rgb(var(--bg-rgb) / <alpha-value>)',
        deep: 'rgb(var(--deep-rgb) / <alpha-value>)',
        well: 'rgb(var(--well-rgb) / <alpha-value>)',
        well2: 'rgb(var(--well2-rgb) / <alpha-value>)',
        panel: 'rgb(var(--panel-rgb) / <alpha-value>)',
        pop: 'rgb(var(--pop-rgb) / <alpha-value>)',
        elevated: 'rgb(var(--elevated-rgb) / <alpha-value>)',
        card: 'rgb(var(--card-rgb) / <alpha-value>)',
        card2: 'rgb(var(--card2-rgb) / <alpha-value>)',
        line: 'rgb(var(--line-rgb) / <alpha-value>)',
        line2: 'rgb(var(--line-soft-rgb) / <alpha-value>)',
        'line-soft': 'rgb(var(--line-soft-rgb) / <alpha-value>)',
        ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
        ink2: 'rgb(var(--ink2-rgb) / <alpha-value>)',
        ink3: 'rgb(var(--ink3-rgb) / <alpha-value>)',
        accent: {
          DEFAULT: 'rgb(var(--accent-rgb) / <alpha-value>)',
          bright: 'rgb(var(--accent-bright-rgb) / <alpha-value>)',
          dim: 'rgb(var(--accent-dim-rgb) / <alpha-value>)',
          on: 'rgb(var(--on-accent-rgb) / <alpha-value>)',
          wash: 'rgb(var(--accent-rgb) / 0.10)'
        },
        ok: 'rgb(var(--ok-rgb) / <alpha-value>)',
        bad: 'rgb(var(--bad-rgb) / <alpha-value>)',
        warn: 'rgb(var(--warn-rgb) / <alpha-value>)',
        info: 'rgb(var(--info-rgb) / <alpha-value>)',
        sheen: 'rgb(var(--sheen-rgb) / <alpha-value>)'
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'JetBrains Mono', 'Menlo', 'Consolas', 'monospace'],
        cine: ['Georgia', 'Iowan Old Style', 'Times New Roman', 'serif']
      },
      fontSize: {
        '2xs': ['10px', '14px'],
        micro: ['9px', '12px']
      },
      borderRadius: {
        xs: '3px', sm: '5px', md: '8px', lg: '11px', xl: '14px', '2xl': '18px'
      },
      boxShadow: {
        panel: '0 1px 0 rgb(var(--sheen-rgb) / 0.03) inset, 0 18px 40px -24px rgb(0 0 0 / 0.9)',
        card: '0 1px 0 rgb(var(--sheen-rgb) / 0.035) inset, 0 10px 26px -18px rgb(0 0 0 / 0.85)',
        pop: '0 24px 70px -20px rgb(0 0 0 / 0.95), 0 0 0 1px rgb(var(--sheen-rgb) / 0.05)',
        glow: '0 0 0 1px rgb(var(--accent-rgb) / 0.35), 0 0 24px -6px rgb(var(--accent-rgb) / 0.35)',
        inset: 'inset 0 1px 2px rgb(0 0 0 / 0.6)'
      },
      backgroundImage: {
        'gloss': 'linear-gradient(180deg, rgb(var(--sheen-rgb) / 0.055) 0%, rgb(var(--sheen-rgb) / 0.012) 42%, rgb(var(--sheen-rgb) / 0) 60%)',
        'gloss-accent': 'linear-gradient(180deg, rgb(var(--accent-bright-rgb)) 0%, rgb(var(--accent-rgb)) 48%, rgb(var(--accent-dim-rgb)) 100%)',
        'panel-grad': 'linear-gradient(180deg, rgb(var(--elevated-rgb)) 0%, rgb(var(--panel-rgb)) 100%)',
        'card-grad': 'linear-gradient(180deg, rgb(var(--sheen-rgb) / 0.045) 0%, rgb(var(--sheen-rgb) / 0.012) 34%, rgb(var(--sheen-rgb) / 0) 62%), linear-gradient(180deg, rgb(var(--card-rgb)) 0%, rgb(var(--card2-rgb)) 100%)',
        'vignette': 'radial-gradient(120% 90% at 50% 0%, rgb(var(--accent-rgb) / 0.06) 0%, rgb(0 0 0 / 0) 55%)',
        'stage-active': 'linear-gradient(180deg, rgb(var(--accent-rgb) / 0.20) 0%, rgb(var(--accent-rgb) / 0.06) 100%)'
      },
      keyframes: {
        shimmer: { '0%': { backgroundPosition: '-420px 0' }, '100%': { backgroundPosition: '420px 0' } },
        sweep: { '0%': { transform: 'translateX(-120%)' }, '100%': { transform: 'translateX(220%)' } },
        pulseDot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        floatUp: { '0%': { opacity: '0', transform: 'translateY(6px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        spinSlow: { '100%': { transform: 'rotate(360deg)' } },
        barber: { '0%': { backgroundPosition: '0 0' }, '100%': { backgroundPosition: '28px 0' } }
      },
      animation: {
        shimmer: 'shimmer 1.5s linear infinite',
        sweep: 'sweep 2.6s cubic-bezier(.4,0,.2,1) infinite',
        pulseDot: 'pulseDot 1.6s ease-in-out infinite',
        floatUp: 'floatUp .22s ease-out both',
        spinSlow: 'spinSlow 9s linear infinite',
        barber: 'barber .7s linear infinite'
      },
      transitionTimingFunction: { cine: 'cubic-bezier(.22,.61,.36,1)' }
    }
  },
  plugins: []
};
export default config;
