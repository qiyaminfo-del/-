/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { readFileSync } from 'node:fs';

// رؤوس الأمان مصدرها واحد: vercel.json. نطبّقها على المعاينة المحلية (vite preview)
// حتى نختبر الـ CSP على النسخة المبنية قبل النشر. لا تُطبَّق على خادم التطوير (HMR يحتاج سكربتات مضمّنة).
function securityHeaders(): Record<string, string> {
  const cfg = JSON.parse(readFileSync(path.resolve(__dirname, 'vercel.json'), 'utf8')) as {
    headers: { source: string; headers: { key: string; value: string }[] }[];
  };
  const all = cfg.headers.find((h) => h.source === '/(.*)');
  return Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { port: 5173 },
  preview: { headers: securityHeaders() },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
