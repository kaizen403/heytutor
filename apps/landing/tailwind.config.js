/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        heading: ['Stack Sans Notch', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        accent: ['DM Mono', 'ui-monospace', 'monospace'],
        hand: ['Caveat', 'cursive'],
      },
      colors: {
        /* ── Ink: the deep navy canvas (inBuild's background system) ───── */
        ink: {
          950: '#06121C',
          900: '#0A1B27',
          850: '#0D2231', // inBuild --background-color--background-primary
          800: '#122A39',
          750: '#182D47', // inBuild --background-color--button-dark
          700: '#1B3242',
          600: '#2C3C4A',
          500: '#3B5362',
          400: '#5D6C7B',
          300: '#758696',
          200: '#8797A0', // inBuild --pricing-outline
        },
        /* ── Sky: the accent light (inBuild's #59AFD4 ramp) ────────────── */
        sky: {
          700: '#2E7CA3',
          600: '#3E8FB4',
          500: '#59AFD4', // inBuild --base-color-neutral--color-accent
          400: '#7FC4E2',
          300: '#A5D6EC',
          200: '#CCE6F1', // inBuild --keymetric1
          100: '#E4F2F9',
        },
        steel: '#608B9D',  // inBuild --keymetric3
        mist: '#ABC9D5',   // inBuild --feature-section-bg
        frost: '#F0F5F7',  // inBuild light neutral
        /* ── Accelute's own blues, kept for depth in gradients ─────────── */
        brand: {
          fg: '#F0F5F7',
          'fg-soft': '#DCE9F0',
          muted: '#8797A0',
          'muted-dark': '#A9BCC7',
          primary: '#5FA4F9',
          'primary-light': '#7FC4E2',
          'primary-deep': '#2563EB',
          cta: '#59AFD4',
          surface: '#0D2231',
          section: '#0A1B27',
          'section-blue': '#122A39',
          border: 'rgba(202, 229, 241, 0.14)',
          slate: '#608B9D',
          'on-dark': '#F0F5F7',
          footer: '#06121C',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(89,175,212,0.30), 0 18px 50px -18px rgba(89,175,212,0.55)',
        'glow-lg': '0 0 0 1px rgba(89,175,212,0.28), 0 40px 110px -40px rgba(89,175,212,0.60)',
        lift: '0 28px 70px -34px rgba(3,11,18,0.95)',
      },
    },
  },
  plugins: [],
};
