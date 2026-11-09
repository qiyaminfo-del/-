import { useState } from 'react';
import { CalendarDays, UserCog, UsersRound, type LucideIcon } from 'lucide-react';
import { useApp, useIsAdmin } from '@/store/session';
import { Empty, PageHead } from '@/components/ui';
import Members from './admin/Members';
import Groups from './admin/Groups';
import Sessions from './admin/Sessions';

type Tab = 'members' | 'groups' | 'sessions';

const TABS: { key: Tab; label: string; icon: LucideIcon }[] = [
  { key: 'members', label: 'الأعضاء', icon: UserCog },
  { key: 'groups', label: 'المجموعات', icon: UsersRound },
  { key: 'sessions', label: 'الجلسات', icon: CalendarDays },
];

export default function Admin() {
  const activeCircleId = useApp((s) => s.activeCircleId);
  const isAdmin = useIsAdmin();
  const [tab, setTab] = useState<Tab>('members');

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (!isAdmin) return <Empty title="للمدير فقط" hint="إدارة الأعضاء والمجموعات من صلاحيات مدير المنصة." />;

  return (
    <>
      <PageHead title="لوحة الإدارة" sub="الأعضاء وأدوارهم ونطاقهم، والمجموعات، والجلسات" />

      <div role="tablist" aria-label="أقسام الإدارة" className="mb-5 flex gap-1 rounded-2xl border border-line bg-white p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-brand-800 text-white shadow-sm' : 'text-ink-soft hover:bg-stone-50'
            }`}
          >
            <t.icon size={16} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'members' && <Members circleId={activeCircleId} />}
      {tab === 'groups' && <Groups circleId={activeCircleId} />}
      {tab === 'sessions' && <Sessions circleId={activeCircleId} />}
    </>
  );
}
