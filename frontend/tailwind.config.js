/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#f0fdf9',
          100: '#ccfbee',
          200: '#99f6dd',
          300: '#5fecc7',
          400: '#2dd8ac',
          500: '#14b893',
          600: '#0d9276',
          700: '#0e7560',
          800: '#0f5e4e',
          900: '#104d41',
          950: '#042e28',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      }
    }
  },
  plugins: []
}
