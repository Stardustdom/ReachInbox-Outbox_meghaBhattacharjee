import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#e6f5ea', 100: '#cfeedb', 500: '#00a63e', 600: '#008f35', 700: '#007a2e' },
        surface: '#eff1f0',
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'] },
      keyframes: { 'slide-in': { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'none', opacity: '1' } } },
      animation: { 'slide-in': 'slide-in 150ms ease-out' },
    },
  },
  plugins: [],
};
export default config;
