import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import {
  BookOpenCheck,
  Building2,
  ChartPie,
  ChartColumn,
  ChevronsRight,
  ClipboardCheck,
  Ellipsis,
  House,
  ListChecks,
  LogOut,
  NotebookPen,
  PhoneCall,
  ShieldCheck,
  UsersRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useApp } from '@/store/session';
import { clearFailed, failedCount, failedOps, pendingCount, startAutoSync } from '@/lib/offline';
import { ROLE_LABEL, type RoleKey } from '@/lib/types';
import { LogoMark, Wordmark } from '@/components/Logo';
import { Sheet } from '@/components/ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  roles: RoleKey[] | 'all';
  group: 'daily' | 'oversight' | 'admin';
}

const NAV: NavItem[] = [
  { to: '/', label: 'الرئيسية', icon: House, roles: 'all', group: 'daily' },
  { to: '/my-list', label: 'قائمتي', icon: PhoneCall, roles: ['contact_officer'], group: 'daily' },
  { to: '/attendance', label: 'الحضور', icon: ClipboardCheck, roles: ['attendance_officer'], group: 'daily' },
  { to: '/fees', label: 'الرسوم', icon: Wallet, roles: ['finance_officer'], group: 'daily' },
  { to: '/tasks', label: 'التكاليف', icon: ListChecks, roles: ['tasks_officer'], group: 'daily' },
  { to: '/summaries', label: 'التفريغ', icon: NotebookPen, roles: ['transcription_officer'], group: 'daily' },
  { to: '/wird', label: 'الأوراد', icon: BookOpenCheck, roles: 'all', group: 'daily' },
  { to: '/report', label: 'تقرير المجلس', icon: ChartColumn, roles: ['sheikh', 'admin'], group: 'oversight' },
  { to: '/team', label: 'أداء الفريق', icon: UsersRound, roles: ['sheikh', 'admin'], group: 'oversight' },
  {
    to: '/reports',
    label: 'التقارير',
    icon: ChartPie,
    roles: ['sheikh', 'admin', 'attendance_officer', 'finance_officer', 'tasks_officer'],
    group: 'oversight',
  },
  { to: '/admin', label: 'الإدارة', icon: ShieldCheck, roles: ['admin'], group: 'admin' },
];

const GROUP_LABEL: Record<NavItem['group'], string> = {
  daily: 'العمل اليومي',
  oversight: 'الإشراف',
  admin: 'الإدارة',
};

/** أعلى دور يظهر تحت الاسم */
const ROLE_PRIORITY: RoleKey[] = [
  'admin',
  'sheikh',
  'contact_officer',
  'attendance_officer',
  'finance_officer',
  'tasks_officer',
  'transcription_officer',
  'member',
  'student',
];

const SIDEBAR_KEY = 'majales.sidebar';
const readCollapsed = () => {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === '1';
  } catch {
    return false;
  }
};

export default function Layout() {
  const { roles, circles, activeCircleId, setActiveCircle, profile, signOut, pendingSync, setPendingSync } =
    useApp();
  const [failed, setFailed] = useState(0);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const refresh = () => {
      void pendingCount().then(setPendingSync);
      void failedCount().then(setFailed);
    };
    const stop = startAutoSync(refresh);
    refresh();
    return stop;
  }, [setPendingSync]);

  function toggleCollapsed() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      } catch {
        /* التفضيل اختياري */
      }
      return !c;
    });
  }

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
  const isAdmin = here.some((r) => r.role === 'admin');
  const myRoles = new Set(here.map((r) => r.role));
  const visible = NAV.filter((n) =>
    // الإدارة (الأدوار والنطاقات) للمدير وحده؛ الشيخ يرى بقية الشاشات
    n.to === '/admin' ? isAdmin : n.roles === 'all' || steward || n.roles.some((r) => myRoles.has(r)),
  );

  const topRole = ROLE_PRIORITY.find((r) => myRoles.has(r));
  const name = profile?.full_name ?? '';
  const initial = name.trim().charAt(0) || '؟';

  const sync = (
    <>
      {pendingSync > 0 && (
        <span className="chip bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-200">
          {pendingSync} بانتظار المزامنة
        </span>
      )}
      {failed > 0 && (
        <button
          className="chip bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-200"
          onClick={() => void showFailed()}
        >
          {failed} تعذّر رفعها
        </button>
      )}
    </>
  );

  const circleSelect = circles.length > 0 && (
    <div className="relative">
      <Building2
        size={16}
        className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-gold-300 lg:text-gold-300"
      />
      <select
        aria-label="المجلس"
        className="w-full appearance-none rounded-xl border border-white/10 bg-white/[0.06] py-2.5 pe-3 ps-9 text-sm text-white outline-none transition hover:bg-white/10 focus:border-gold-400/60 lg:block [&>option]:text-ink"
        value={activeCircleId ?? ''}
        onChange={(e) => setActiveCircle(e.target.value)}
      >
        {circles.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );

  // الشريط السفلي للهاتف: أول ٤ شاشات + «المزيد» إن زادت عن ٥
  const bottomItems = visible.length > 5 ? visible.slice(0, 4) : visible;
  const overflow = visible.length > 5 ? visible.slice(4) : [];

  return (
    <div className="min-h-dvh">
      {/* ===== الشريط الجانبي (الشاشات الكبيرة) ===== */}
      <aside
        className={`fixed inset-y-0 start-0 z-40 hidden flex-col bg-side text-white transition-[width] duration-300 lg:flex ${
          collapsed ? 'w-[84px]' : 'w-[272px]'
        }`}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(420px_260px_at_100%_0%,rgba(201,162,85,0.14),transparent_70%)]" />

        <div className="relative flex items-center gap-3 px-5 pb-4 pt-6">
          <LogoMark size={collapsed ? 44 : 40} className="shrink-0" />
          {!collapsed && <Wordmark className="text-white" />}
          <button
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'توسيع الشريط' : 'طيّ الشريط'}
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white ${
              collapsed ? 'absolute -start-0 top-7 hidden' : 'ms-auto'
            }`}
          >
            <ChevronsRight size={18} />
          </button>
        </div>

        {collapsed && (
          <button
            onClick={toggleCollapsed}
            aria-label="توسيع الشريط"
            className="relative mx-auto mb-2 grid h-8 w-8 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-white"
          >
            <ChevronsRight size={18} className="rotate-180" />
          </button>
        )}

        {!collapsed && <div className="relative px-4 pb-3">{circleSelect}</div>}

        <nav aria-label="التنقل الرئيسي" className="relative flex-1 overflow-y-auto px-3 pb-4">
          {(['daily', 'oversight', 'admin'] as const).map((g) => {
            const items = visible.filter((n) => n.group === g);
            if (!items.length) return null;
            return (
              <div key={g} className="mt-4 first:mt-1">
                {!collapsed ? (
                  <p className="mb-1.5 px-3 text-[11px] font-medium tracking-wide text-white/35">{GROUP_LABEL[g]}</p>
                ) : (
                  <div className="mx-4 mb-2 h-px bg-white/10" />
                )}
                <ul className="space-y-0.5">
                  {items.map((n) => (
                    <li key={n.to}>
                      <NavLink
                        to={n.to}
                        end={n.to === '/'}
                        title={collapsed ? n.label : undefined}
                        className={({ isActive }) =>
                          `group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] transition ${
                            collapsed ? 'justify-center' : ''
                          } ${
                            isActive
                              ? 'bg-white/[0.09] font-medium text-gold-200'
                              : 'text-white/70 hover:bg-white/[0.05] hover:text-white'
                          }`
                        }
                      >
                        {({ isActive }) => (
                          <>
                            {isActive && (
                              <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-gold-400" />
                            )}
                            <n.icon size={20} strokeWidth={isActive ? 2 : 1.7} className="shrink-0" />
                            <span className={collapsed ? 'sr-only' : ''}>{n.label}</span>
                          </>
                        )}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </nav>

        <div className="relative border-t border-white/10 p-3">
          {!collapsed && (pendingSync > 0 || failed > 0) && <div className="mb-2 flex flex-wrap gap-1.5 px-1">{sync}</div>}
          <div className={`flex items-center gap-3 rounded-xl p-2 ${collapsed ? 'justify-center' : ''}`}>
            <Avatar initial={initial} />
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name || 'مستخدم'}</p>
                <p className="truncate text-xs text-white/45">{topRole ? ROLE_LABEL[topRole] : 'طالب'}</p>
              </div>
            )}
            <button
              onClick={() => void signOut()}
              aria-label="تسجيل الخروج"
              title="تسجيل الخروج"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white/50 transition hover:bg-white/10 hover:text-rose-200"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>

      <div className={`transition-[padding] duration-300 ${collapsed ? 'lg:ps-[84px]' : 'lg:ps-[272px]'}`}>
        {/* ===== الشريط العلوي (الهاتف) ===== */}
        <header className="sticky top-0 z-30 border-b border-line bg-surface/85 backdrop-blur-md lg:hidden">
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            <LogoMark size={34} />
            {circles.length > 0 && (
              <div className="min-w-0 flex-1">
                <select
                  aria-label="المجلس"
                  className="w-full truncate rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-brand-500"
                  value={activeCircleId ?? ''}
                  onChange={(e) => setActiveCircle(e.target.value)}
                >
                  {circles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center gap-1.5">{sync}</div>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-4 pb-28 pt-6 lg:px-10 lg:pb-14 lg:pt-10">
          <Outlet />
        </main>
      </div>

      {/* ===== الشريط السفلي (الهاتف) ===== */}
      <nav
        aria-label="التنقل السفلي"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white/92 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_24px_rgba(13,28,24,0.06)] backdrop-blur-md lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1.5 py-1.5">
          {bottomItems.map((n) => (
            <li key={n.to} className="min-w-0 flex-1">
              <NavLink
                to={n.to}
                end={n.to === '/'}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] transition ${
                    isActive ? 'text-brand-800' : 'text-ink-faint hover:text-ink-soft'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <span
                      className={`grid h-8 w-12 place-items-center rounded-full transition ${
                        isActive ? 'bg-gold-100 text-brand-800' : ''
                      }`}
                    >
                      <n.icon size={21} strokeWidth={isActive ? 2.1 : 1.7} />
                    </span>
                    <span className={`truncate ${isActive ? 'font-semibold' : ''}`}>{n.label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
          {overflow.length > 0 && (
            <li className="min-w-0 flex-1">
              <button
                onClick={() => setMore(true)}
                className="flex w-full flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[11px] text-ink-faint transition hover:text-ink-soft"
              >
                <span className="grid h-8 w-12 place-items-center">
                  <Ellipsis size={21} strokeWidth={1.7} />
                </span>
                <span>المزيد</span>
              </button>
            </li>
          )}
        </ul>
      </nav>

      <Sheet open={more} onClose={() => setMore(false)} title="المزيد">
        <ul className="space-y-1.5">
          {overflow.map((n) => (
            <li key={n.to}>
              <NavLink
                to={n.to}
                onClick={() => setMore(false)}
                className="flex items-center gap-3 rounded-xl border border-line px-4 py-3 text-[15px] transition hover:bg-stone-50"
              >
                <n.icon size={20} className="text-brand-700" strokeWidth={1.8} />
                {n.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex items-center gap-3 rounded-2xl bg-stone-50 p-3">
          <Avatar initial={initial} dark />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{name || 'مستخدم'}</p>
            <p className="text-xs text-ink-soft">{topRole ? ROLE_LABEL[topRole] : 'طالب'}</p>
          </div>
          <button onClick={() => void signOut()} className="btn-ghost px-3 py-2 text-xs">
            <LogOut size={15} />
            خروج
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Avatar({ initial, dark = false }: { initial: string; dark?: boolean }): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={`display grid h-10 w-10 shrink-0 place-items-center rounded-full text-xl ring-1 ${
        dark ? 'bg-brand-800 text-gold-200 ring-gold-400/40' : 'bg-white/[0.08] text-gold-200 ring-gold-400/40'
      }`}
    >
      {initial}
    </span>
  );
}
