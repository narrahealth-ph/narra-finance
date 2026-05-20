/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,jsx,tsx}', './components/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        narra: {
          dark:    '#173f46',
          green:   '#c7e995',
          mid:     '#1e5260',
          light:   '#e8f5d0',
          muted:   '#8aab6e',
          ink:     '#0d2b30',
          surface: '#f4faf0',
          border:  '#d0e8b8',
        },
      },
      fontFamily: {
        heading: ['Albert Sans', 'sans-serif'],
        body:    ['Inter', 'sans-serif'],
      },
      keyframes: {
        'loading-bar': {
          '0%':   { transform: 'translateX(-100%)' },
          '50%':  { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-up': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
      },
      animation: {
        'loading-bar': 'loading-bar 1.2s ease-in-out infinite',
        'fade-up':     'fade-up 0.3s ease-out both',
        'pulse-soft':  'pulse-soft 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
