/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-base': '#0f0f0f',
        'bg-elevated': '#1a1a1a',
        'bg-surface': '#222222',
        'bg-hover': '#2a2a2a',
        'border-subtle': '#333333',
        'border-active': '#444444',
        'text-primary': '#e0e0e0',
        'text-secondary': '#a0a0a0',
        'text-tertiary': '#666666',
        'accent-red': '#e74c3c',
        'accent-amber': '#f39c12',
        'accent-green': '#2ecc71',
        'accent-blue': '#3498db',
      },
    },
  },
  plugins: [],
}
