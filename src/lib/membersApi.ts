/** استدعاء خادم الأعضاء (api/members) برمز دخول المستخدم الحالي. */
import { supabase } from '@/lib/supabase';

type Action =
  | { action: 'create'; circle_id: string; full_name: string; username: string; password: string; roles: string[] }
  | { action: 'set_password'; target_id: string; password: string }
  | { action: 'set_disabled'; target_id: string; disabled: boolean };

export async function membersApi<T = Record<string, unknown>>(body: Action): Promise<{ data?: T; error?: string }> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return { error: 'سجّل الدخول أولًا.' };
  try {
    const res = await fetch('/api/members', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      if (res.status === 404) return { error: 'خادم إدارة الحسابات غير متاح هنا (يعمل على Vercel فقط).' };
      return { error: String(json.error ?? 'تعذّر إتمام العملية.') };
    }
    return { data: json as T };
  } catch {
    return { error: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت.' };
  }
}
