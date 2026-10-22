/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        star: { blue: '#1239B8', ink: '#102A72', pink: '#F72585', yellow: '#FFC928', sky: '#42B8E8', mint: '#B8F2E6', cream: '#FFFDF5' },
      },
      fontFamily: { sans: ['Nunito', 'sans-serif'], display: ['Baloo 2', 'Nunito', 'sans-serif'] },
    },
  },
  plugins: [],
}
