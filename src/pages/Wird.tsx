import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, BookOpenCheck, Layers, UsersRound, type LucideIcon } from 'lucide-react';
import { useApp, useIsSteward } from '@/store/session';
import { Empty, Loading, PageHead } from '@/components/ui';
import { loadCatalog, type WirdCatalog } from './wird/data';
import DayForm from './wird/DayForm';
import LevelsAdmin from './wird/LevelsAdmin';
import StudentsLevels from './wird/StudentsLevels';
import type { StudentLite } from './admin/shared';

type Tab = 'students' | 'levels';

export default function Wird() {
  const { activeCircleId, roles, profile } = useApp();
  const steward = useIsSteward();
  const isWirdOfficer = roles.some((r) => r.role === 'tasks_officer' && r.circle_id === activeCircleId);
  const staff = steward || isWirdOfficer;

  const [catalog, setCatalog] = useState<WirdCatalog | null>(null);
  const [tab, setTab] = useState<Tab>('students');
  const [student, setStudent] = useState<StudentLite | null>(null);

  const load = useCallback(async () => {
    if (!activeCircleId) return;
    setCatalog(await loadCatalog(activeCircleId));
  }, [activeCircleId]);

  useEffect(() => {
    setCatalog(null);
    setStudent(null);
    void load();
  }, [load]);

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (!catalog || !profile) return <Loading />;

  // الطالب: أوراد مستواه فقط
  if (!staff) {
    return (
      <>
        <PageHead title="أورادي" sub="أوراد مستواك لكل يوم؛ كل تعديل يُحفظ فورًا" />
        <DayForm
          circleId={activeCircleId}
          studentId={profile.id}
          catalog={catalog}
          emptyHint="سيحدد لك الشيخ أو مسؤول الأوراد مستواك، فتظهر هنا أوراده."
        />
      </>
    );
  }

  // متابعة طالب بعينه
  if (student) {
    return (
      <>
        <button className="mb-3 flex items-center gap-1.5 text-sm text-ink-soft hover:text-ink" onClick={() => setStudent(null)}>
          <ArrowRight size={16} />
          الطلاب والمستويات
        </button>
        <PageHead title={student.full_name} sub="متابعة الأوراد اليومية" />
        <DayForm
          circleId={activeCircleId}
          studentId={student.id}
          catalog={catalog}
          emptyHint="عيّن لهذا الطالب مستوى من قائمة الطلاب أولًا."
        />
      </>
    );
  }

  const tabs: { key: Tab; label: string; icon: LucideIcon; show: boolean }[] = [
    { key: 'students', label: 'الطلاب والمستويات', icon: UsersRound, show: true },
    { key: 'levels', label: 'المستويات والعبادات', icon: Layers, show: steward },
  ];

  return (
    <>
      <PageHead title="متابعة الأوراد" sub="مستويات مرنة؛ لكل طالب أوراد مستواه، والتقارير تُحسب عليها" />

      <div role="tablist" aria-label="أقسام الأوراد" className="mb-5 flex gap-1 rounded-2xl border border-line bg-white p-1">
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                tab === t.key ? 'bg-brand-800 text-white' : 'text-ink-soft hover:bg-stone-50'
              }`}
            >
              <t.icon size={16} />
              {t.label}
            </button>
          ))}
      </div>

      {tab === 'levels' && steward ? (
        <LevelsAdmin circleId={activeCircleId} catalog={catalog} onChanged={() => void load()} />
      ) : (
        <>
          {catalog.levels.length > 0 && (
            <p className="mb-3 flex items-center gap-1.5 text-xs text-ink-soft">
              <BookOpenCheck size={14} />
              اضغط اسم الطالب لمتابعة أوراده يومًا بيوم.
            </p>
          )}
          <StudentsLevels circleId={activeCircleId} catalog={catalog} onOpenStudent={setStudent} />
        </>
      )}
    </>
  );
}
