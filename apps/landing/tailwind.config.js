/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        heading: ['Manrope', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        brand: {
          fg: '#000000',
          'fg-soft': '#111827',
          muted: '#6B7280',
          'muted-dark': '#4B5563',
          primary: '#2563EB',
          'primary-light': '#5FA4F9',
          cta: '#222222',
          surface: '#FFFFFF',
          section: '#F2F3F7',
          'section-blue': '#EDF3FD',
          border: '#E5E7EB',
          slate: '#37546D',
          'on-dark': '#F8F9FA',
          footer: '#06061F',
        },
      },
    },
  },
  plugins: [],
};
