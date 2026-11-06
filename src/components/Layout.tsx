import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useApp } from '@/store/session';
import { clearFailed, failedCount, failedOps, pendingCount, startAutoSync } from '@/lib/offline';
import type { RoleKey } from '@/lib/types';

interface NavItem {
  to: string;
  label: string;
  roles: RoleKey[] | 'all';
}

const NAV: NavItem[] = [
  { to: '/', label: 'الرئيسية', roles: 'all' },
  { to: '/my-list', label: 'قائمتي', roles: ['contact_officer'] },
  { to: '/attendance', label: 'الحضور', roles: ['attendance_officer'] },
  { to: '/fees', label: 'الرسوم', roles: ['finance_officer'] },
  { to: '/tasks', label: 'التكاليف', roles: ['tasks_officer'] },
  { to: '/summaries', label: 'التفريغ', roles: ['transcription_officer'] },
  { to: '/report', label: 'تقرير المجلس', roles: ['sheikh', 'admin'] },
  { to: '/team', label: 'أداء الفريق', roles: ['sheikh', 'admin'] },
  { to: '/admin', label: 'الإدارة', roles: ['admin'] },
];

export default function Layout() {
  const { roles, circles, activeCircleId, setActiveCircle, profile, signOut, pendingSync, setPendingSync } =
    useApp();
  const [failed, setFailed] = useState(0);

  useEffect(() => {
    const refresh = () => {
      void pendingCount().then(setPendingSync);
      void failedCount().then(setFailed);
    };
    const stop = startAutoSync(refresh);
    refresh();
    return stop;
  }, [setPendingSync]);

  async function showFailed() {
    const ops = await failedOps();
    const lines = ops.slice(0, 10).map((o) => `• ${o.table}: ${o.error}`).join('\n');
    if (confirm(`تعذّر رفع ${ops.length} تسجيلات ورفضتها القاعدة:\n${lines}\n\nإخفاء هذا التنبيه؟`)) {
      await clearFailed();
      setFailed(0);
    }
  }

  // القائمة تتبع أدواري في المجلس النشط (أو مجلسه الأب) لا في أي مجلس
  const active = circles.find((c) => c.id === activeCircleId);
  const here = roles.filter((r) => r.circle_id === activeCircleId || r.circle_id === active?.parent_circle_id);
  const steward = here.some((r) => r.role === 'admin' || r.role === 'sheikh');
  const myRoles = new Set(here.map((r) => r.role));
  const visible = NAV.filter(
    (n) => n.roles === 'all' || steward || n.roles.some((r) => myRoles.has(r)),
  );

  return (
    <div className="min-h-dvh pb-20">
      <header className="sticky top-0 z-40 border-b border-line bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <span className="text-lg font-bold text-brand-700">مجالس</span>

          {circles.length > 0 && (
            <select
              className="rounded-lg border border-line bg-white px-2 py-1.5 text-sm"
              value={activeCircleId ?? ''}
              onChange={(e) => setActiveCircle(e.target.value)}
            >
              {circles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}

          <div className="me-auto" />

          {pendingSync > 0 && (
            <span className="chip bg-amber-100 text-amber-800">{pendingSync} بانتظار المزامنة</span>
          )}

          {failed > 0 && (
            <button className="chip bg-rose-100 text-rose-800" onClick={() => void showFailed()}>
              {failed} تعذّر رفعها
            </button>
          )}

          <button onClick={() => void signOut()} className="text-sm text-ink-soft hover:text-ink">
            {profile?.full_name?.split(' ')[0] ?? 'خروج'} · خروج
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        <Outlet />
      </main>

      <nav className="fixed bottom-0 z-40 w-full border-t border-line bg-white/95 backdrop-blur">
        <div className="scroll-x mx-auto flex max-w-5xl gap-1 px-2 py-2">
          {visible.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `whitespace-nowrap rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                  isActive ? 'bg-brand-700 text-white' : 'text-ink-soft hover:bg-stone-100'
                }`
              }
            >
              {n.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
