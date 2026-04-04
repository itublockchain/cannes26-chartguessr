import tailwindcssAnimate from "tailwindcss-animate"

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        sans: ['Satoshi', 'sans-serif'],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        floatAvatar: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-15px)' },
        },
        moveStars: {
          'from': { backgroundPosition: '0 0' },
          'to': { backgroundPosition: '-10000px 5000px' },
        },
        blobMorph: {
          '0%':   { transform: 'rotate(13deg) scale(1, 1) translate(0px, 0px)' },
          '15%':  { transform: 'rotate(19deg) scale(1.12, 0.88) translate(4px, -12px)' },
          '30%':  { transform: 'rotate(7deg) scale(0.9, 1.11) translate(-5px, 7px)' },
          '47%':  { transform: 'rotate(21deg) scale(1.08, 0.91) translate(6px, -9px)' },
          '62%':  { transform: 'rotate(9deg) scale(0.93, 1.09) translate(-4px, 8px)' },
          '78%':  { transform: 'rotate(17deg) scale(1.06, 0.93) translate(5px, -6px)' },
          '100%': { transform: 'rotate(13deg) scale(1, 1) translate(0px, 0px)' },
        },
        loadProgress: {
          '0%':   { width: '8%' },
          '60%':  { width: '80%' },
          '100%': { width: '8%' },
        },
        countdownFill: {
          '0%': { width: '0%' },
          '100%': { width: '100%' },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        'float-avatar': 'floatAvatar 4s ease-in-out infinite',
        'move-stars': 'moveStars 100s linear infinite',
        'blob-morph': 'blobMorph 7s ease-in-out infinite',
        'load-progress': 'loadProgress 2.5s ease-in-out infinite',
        'countdown-fill': 'countdownFill 3s ease-in-out forwards',
      },
    },
  },
  plugins: [tailwindcssAnimate],
}
