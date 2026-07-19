/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        /* ---- Kernelspace core tokens (design.md §3) ---- */
        ink: '#07090D',
        'surface-1': '#0C1017',
        'surface-2': '#111722',
        'surface-3': '#182130',
        line: '#1E2937',
        'line-bright': '#2C3A4F',
        'text-1': '#E8EEF6',
        'text-2': '#A3B0C2',
        'text-3': '#5D6B80',
        accent: {
          DEFAULT: '#3EF2A4',
          dim: '#173B2E',
          foreground: '#06251A',
        },
        amber: '#FFB224',
        danger: '#FF5C6C',
        info: '#5CA8FF',
        /* ---- Track colors (design.md §3.2) ---- */
        t0: '#34D399',
        t1: '#FBBF24',
        t2: '#22D3EE',
        t3: '#F97316',
        t4: '#A78BFA',
        t5: '#FB7185',
        /* ---- shadcn semantic tokens (dark-only, mapped to palette) ---- */
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar-background))',
          foreground: 'hsl(var(--sidebar-foreground))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          border: 'hsl(var(--sidebar-border))',
          ring: 'hsl(var(--sidebar-ring))',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        'display-xl': ['64px', { lineHeight: '1.02', letterSpacing: '-0.03em', fontWeight: '700' }],
        'display-lg': ['48px', { lineHeight: '1.06', letterSpacing: '-0.025em', fontWeight: '700' }],
        h1: ['40px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
        h2: ['30px', { lineHeight: '1.2', letterSpacing: '-0.015em', fontWeight: '700' }],
        h3: ['24px', { lineHeight: '1.25', letterSpacing: '-0.01em', fontWeight: '500' }],
        h4: ['19px', { lineHeight: '1.3', fontWeight: '500' }],
        'body-lg': ['18px', { lineHeight: '1.65' }],
        body: ['16px', { lineHeight: '1.6' }],
        'body-sm': ['14px', { lineHeight: '1.5' }],
        label: ['12px', { lineHeight: '1.3', letterSpacing: '0.10em' }],
        code: ['14px', { lineHeight: '1.65' }],
        stat: ['34px', { lineHeight: '1.1', letterSpacing: '-0.02em', fontWeight: '700' }],
      },
      borderRadius: {
        xl: '16px',
        lg: '16px',
        md: '10px',
        sm: '6px',
        xs: '4px',
      },
      maxWidth: {
        app: '1200px',
        prose: '720px',
        measure: '68ch',
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(.16,1,.3,1)',
        snap: 'cubic-bezier(.3,1.4,.4,1)',
      },
      transitionDuration: {
        180: '180ms',
        250: '250ms',
      },
      backgroundImage: {
        'grad-brand': 'linear-gradient(135deg, #3EF2A4 0%, #22D3EE 50%, #A78BFA 100%)',
        'grad-radial-glow': 'radial-gradient(60% 60% at 50% 0%, rgba(62,242,164,.08), transparent 70%)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'caret-blink': {
          '0%, 45%': { opacity: '1' },
          '50%, 95%': { opacity: '0' },
        },
        marquee: {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-50%)' },
        },
        'dash-flow': {
          to: { strokeDashoffset: '-16' },
        },
        breathe: {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '1', transform: 'scale(1.06)' },
        },
        'ring-pulse': {
          '0%': { boxShadow: '0 0 0 0 rgba(62,242,164,.45)' },
          '100%': { boxShadow: '0 0 0 8px rgba(62,242,164,0)' },
        },
        'scroll-cue': {
          '0%, 100%': { transform: 'scaleY(0.3)', transformOrigin: 'top' },
          '50%': { transform: 'scaleY(1)', transformOrigin: 'top' },
        },
        'spin-slow': {
          to: { transform: 'rotate(360deg)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'caret-blink': 'caret-blink 1.06s step-end infinite',
        marquee: 'marquee 40s linear infinite',
        'dash-flow': 'dash-flow 2s linear infinite',
        breathe: 'breathe 5s ease-in-out infinite',
        'ring-pulse': 'ring-pulse 600ms ease-out 1',
        'scroll-cue': 'scroll-cue 1.8s ease-in-out infinite',
        'spin-slow': 'spin-slow 6s linear infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
}
