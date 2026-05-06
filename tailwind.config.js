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
    },
  },
  plugins: [],
}
