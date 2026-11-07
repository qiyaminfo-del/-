/** @type {import('tailwindcss').Config} */
/**
 * هوية «مجالس»: هادئة وفخمة.
 * أخضر داكن عميق (الأساس)، عاجي دافئ (الخلفية)، ذهب خافت (اللمسة)،
 * وألوان الحالة مخفَّضة التشبّع حتى لا تصرخ على العين.
 *
 * الصفحات تستخدم أسماء Tailwind المعتادة (emerald/rose/amber/sky/stone) فأعدنا تعريفها هنا،
 * فتتغير هوية كل الشاشات من ملف واحد.
 *
 * الخطوط: متغيّران فقط (display وsans). لتبديلها بخطوط أخرى (مثل «خط ثمانية» بعد الحصول
 * على ترخيص الويب) غيّر `--font-display` و`--font-sans` في src/index.css وحسب.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'serif'],
      },
      colors: {
        // الأخضر الداكن: الأساس
        brand: {
          50: '#f2f6f4',
          100: '#e0eae5',
          200: '#c2d5cc',
          300: '#98b8aa',
          400: '#6c9582',
          500: '#4b7767',
          600: '#375f51',
          700: '#2a4b40',
          800: '#1f3a31',
          900: '#162c25',
          950: '#0d1c18',
        },
        // الذهب الخافت: اللمسة
        gold: {
          50: '#faf6ec',
          100: '#f3ead3',
          200: '#e8d5a8',
          300: '#d9bb78',
          400: '#c9a255',
          500: '#b18a3d',
          600: '#917030',
          700: '#715727',
        },
        // ألوان الحالة بأسماء Tailwind المألوفة، مخفَّضة التشبّع
        emerald: {
          50: '#f0f7f3',
          100: '#dcede3',
          200: '#b8dac8',
          500: '#4d9a73',
          600: '#3c8160',
          700: '#2f6a4e',
          800: '#265540',
        },
        rose: {
          50: '#fcf2ef',
          100: '#f7e0da',
          200: '#efc0b5',
          500: '#c4604d',
          600: '#ad4938',
          700: '#8c3a2c',
          800: '#722f24',
        },
        amber: {
          50: '#fcf7e9',
          100: '#f7ebc8',
          200: '#efd896',
          400: '#d6a53f',
          500: '#c08e26',
          600: '#a2741d',
          700: '#82601a',
          800: '#684d17',
        },
        sky: {
          100: '#e3eaf3',
          200: '#c6d3e4',
          600: '#4b6b94',
          800: '#31496b',
        },
        // رماديات دافئة بدل الرمادي البارد
        stone: {
          50: '#faf8f3',
          100: '#f2efe7',
          200: '#e5e0d4',
          300: '#d0c9b9',
          400: '#aaa393',
          500: '#857e6f',
          700: '#4d473c',
        },
        ink: {
          DEFAULT: '#1c2926',
          soft: '#52605b',
          faint: '#8a9691',
        },
        surface: '#f6f3ec',
        line: '#e7e2d6',
        side: '#0f211d',
      },
      boxShadow: {
        card: '0 1px 2px rgba(28,41,38,.04), 0 2px 8px rgba(28,41,38,.04)',
        lift: '0 2px 4px rgba(28,41,38,.05), 0 12px 28px rgba(28,41,38,.09)',
        sheet: '0 -8px 40px rgba(13,28,24,.25)',
      },
      borderRadius: {
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      keyframes: {
        rise: { from: { opacity: 0, transform: 'translateY(8px)' }, to: { opacity: 1, transform: 'none' } },
        fade: { from: { opacity: 0 }, to: { opacity: 1 } },
        sheet: { from: { opacity: 0, transform: 'translateY(24px)' }, to: { opacity: 1, transform: 'none' } },
      },
      animation: {
        rise: 'rise .35s cubic-bezier(.2,.7,.2,1) both',
        fade: 'fade .2s ease-out both',
        sheet: 'sheet .28s cubic-bezier(.2,.8,.2,1) both',
      },
    },
  },
  plugins: [],
};
