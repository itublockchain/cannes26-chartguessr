/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        fredoka: ['Fredoka', 'sans-serif'],
      },
      colors: {
        brandPrimary: '#8367f0', // The purple accent
        brandGreen: '#44b62f', // Save button
        brandGreenLight: '#7ded5f', // Save button gradient top
      },
      backgroundImage: {
        'radial-space': 'radial-gradient(circle at center, #1a1a2e 0%, #0f0f1c 100%)',
        'stars-pattern': "url('https://www.transparenttextures.com/patterns/stardust.png')",
        'btn-gradient': 'linear-gradient(180deg, #7ded5f 0%, #44b62f 100%)',
      },
      animation: {
        'float-avatar': 'floatAvatar 4s ease-in-out infinite',
        'move-stars': 'moveStars 100s linear infinite',
      },
      keyframes: {
        floatAvatar: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-15px)' },
        },
        moveStars: {
          'from': { backgroundPosition: '0 0' },
          'to': { backgroundPosition: '-10000px 5000px' },
        }
      }
    },
  },
  plugins: [],
}
