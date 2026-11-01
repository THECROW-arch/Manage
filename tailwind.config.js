/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./public/index.html"
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          charcoal: '#1A1D20', // The dark stroke of the hand/pen
          emerald: '#10B981',  // The vibrant green of the dollar sign
        }
      }
    },
  },
  plugins: [],
}