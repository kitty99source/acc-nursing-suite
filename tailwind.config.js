/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // All colors are driven by CSS variables defined per-theme in index.css.
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        border: 'var(--border)',
        text: 'var(--text)',
        muted: 'var(--muted)',
        accent: 'var(--accent)',
        'accent-fg': 'var(--accent-fg)',
        'accent-soft': 'var(--accent-soft)',
        salmon: 'var(--salmon)',
        'salmon-fg': 'var(--salmon-fg)',
        good: 'var(--good)',
        'good-fg': 'var(--good-fg)',
        warn: 'var(--warn)',
        'warn-fg': 'var(--warn-fg)',
        danger: 'var(--danger)',
        'danger-fg': 'var(--danger-fg)',
      },
      borderColor: {
        DEFAULT: 'var(--border)',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      borderRadius: {
        card: 'var(--radius)',
      },
    },
  },
  plugins: [],
};
