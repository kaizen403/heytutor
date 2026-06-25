/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Nimbus Sans TW01', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
      colors: {
        palette: {
          darkest: '#003C43',
          dark: '#135D66',
          sage: '#77B0AA',
          mint: '#E3FEF7',
        },
      },
    },
  },
  plugins: [],
};
