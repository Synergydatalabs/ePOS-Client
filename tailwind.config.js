/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Meridian brand palette — kept in sync with the SDL landing site
        // at synergydatalabs.com (--m-accent / --m-secondary in
        // meridian.css). Swapping just these tokens re-colors every
        // component that references bg-primary / text-primary / etc.
        // without touching individual files.
        primary: '#3A3EBF',      // indigo — was teal-600 (#0d9488)
        darkprimary: '#2B2F99',  // indigo dark — was teal-700 (#0f766e)
        secondary: '#E85B4C',    // coral — was cyan-500 (#06b6d4)
        accent: '#3A3EBF',       // indigo — was teal-500 (#14b8a6)
        border: '#e5e7eb',
        dark_border: '#374151',
      },
      screens: {
        'xs': '475px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-in-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-slow': 'bounce 2s infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('tailwindcss-animate'),
  ],
};
