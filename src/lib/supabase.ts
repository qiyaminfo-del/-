import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isConfigured = Boolean(url && key);

if (!isConfigured) {
  // لا نُسقط التطبيق: الواجهة تعرض شاشة إعداد بدل الانهيار.
  console.warn('[مجالس] لم تُضبط مفاتيح Supabase بعد. انسخ .env.example إلى .env.');
}

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  key ?? 'placeholder-anon-key',
  {
    auth: { persistSession: true, autoRefreshToken: true },
  },
);
