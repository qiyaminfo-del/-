import { create } from 'zustand';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { clearFailed, clearOutbox, flush, pendingCount } from '@/lib/offline';
import type { Circle, Profile, RoleKey } from '@/lib/types';

interface RoleRow {
  id: string;
  role: RoleKey;
  circle_id: string;
}

interface AppState {
  loading: boolean;
  auth: AuthSession | null;
  profile: Profile | null;
  roles: RoleRow[];
  circles: Circle[];
  activeCircleId: string | null;
  pendingSync: number;
  init: () => Promise<void>;
  refreshContext: () => Promise<void>;
  setActiveCircle: (id: string) => void;
  setPendingSync: (n: number) => void;
  signOut: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  loading: true,
  auth: null,
  profile: null,
  roles: [],
  circles: [],
  activeCircleId: null,
  pendingSync: 0,

  init: async () => {
    const { data } = await supabase.auth.getSession();
    set({ auth: data.session });
    if (data.session) await get().refreshContext();
    set({ loading: false });

    supabase.auth.onAuthStateChange((_event, session) => {
      set({ auth: session });
      if (session) void get().refreshContext();
      else set({ profile: null, roles: [], circles: [], activeCircleId: null });
    });
  },

  refreshContext: async () => {
    const uid = get().auth?.user.id;
    if (!uid) return;

    const [{ data: profile }, { data: roles }, { data: circles }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', uid).maybeSingle(),
      supabase.from('roles').select('id, role, circle_id').eq('profile_id', uid).is('revoked_at', null),
      supabase.from('circles').select('*').eq('is_active', true).order('name'),
    ]);

    const list = (circles ?? []) as Circle[];
    const stored = localStorage.getItem('majales.circle');
    const active =
      (stored && list.some((c) => c.id === stored) ? stored : null) ??
      (roles?.[0] as RoleRow | undefined)?.circle_id ??
      list[0]?.id ??
      null;

    set({
      profile: (profile as Profile) ?? null,
      roles: (roles ?? []) as RoleRow[],
      circles: list,
      activeCircleId: active,
    });
  },

  setActiveCircle: (id) => {
    localStorage.setItem('majales.circle', id);
    set({ activeCircleId: id });
  },

  setPendingSync: (n) => set({ pendingSync: n }),

  signOut: async () => {
    // ارفع ما أمكن أولًا، ثم لا تترك عمليات هذا الحساب لمن يدخل بعده على الجهاز نفسه
    await flush();
    const left = await pendingCount();
    if (
      left > 0 &&
      !confirm(`لديك ${left} تسجيلات حضور لم تُرفع بعد، وستُحذف من هذا الجهاز إن خرجت الآن. الخروج رغم ذلك؟`)
    )
      return;
    await clearOutbox();
    await clearFailed();
    localStorage.removeItem('majales.circle');
    set({ pendingSync: 0 });
    await supabase.auth.signOut();
    set({ auth: null, profile: null, roles: [], circles: [], activeCircleId: null });
  },
}));

/** هل أنا مدير أو شيخ في المجلس النشط أو مجلسه الأب؟ يطابق is_steward في القاعدة. */
export function useIsSteward(): boolean {
  const roles = useApp((s) => s.roles);
  const circles = useApp((s) => s.circles);
  const circleId = useApp((s) => s.activeCircleId);
  const parent = circles.find((c) => c.id === circleId)?.parent_circle_id;
  return roles.some(
    (r) => (r.role === 'admin' || r.role === 'sheikh') && (r.circle_id === circleId || r.circle_id === parent),
  );
}
