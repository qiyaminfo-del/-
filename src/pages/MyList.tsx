import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { useApp } from '@/store/session';
import { useCurrentSession, useTemplates } from '@/hooks/useSessions';
import { Bar, Card, Chip, Empty, Loading, PageHead, Sheet, Stat } from '@/components/ui';
import { fillTemplate, isValidPhone, openWhatsApp } from '@/lib/whatsapp';
import { formatDateTime, percent, relativeDay } from '@/lib/format';
import { CONTACT_LABEL, type ContactOutcome, type Profile } from '@/lib/types';

interface Row extends Profile {
  outcome: ContactOutcome | null;
  contacted_at: string | null;
}

const ORDER: Record<string, number> = { none: 0, no_answer: 1, apologized: 2, wrong_number: 3, confirmed: 4 };

export default function MyList() {
  const { profile, roles, circles, activeCircleId } = useApp();
  const { session } = useCurrentSession();
  const templates = useTemplates();

  const [rows, setRows] = useState<Row[] | null>(null);
  const [waFor, setWaFor] = useState<Row | null>(null);
  const [adding, setAdding] = useState(false);

  const circle = circles.find((c) => c.id === activeCircleId);
  const myRoleId = roles.find((r) => r.role === 'contact_officer' && r.circle_id === activeCircleId)?.id;

  const load = useCallback(async () => {
    if (!activeCircleId) return;
    setRows(null);

    // نطاقي: الطلاب المُسنَدون لي. المدير/الشيخ يرى الجميع.
    let studentIds: Set<string> | null = null;
    if (myRoleId) {
      const data = await fetchAll<{ student_id: string }>(() =>
        supabase.from('assignments').select('id, student_id').eq('role_id', myRoleId).is('revoked_at', null),
      );
      studentIds = new Set(data.map((a) => a.student_id));
    }

    const enrolled = await fetchAll<{ student_id: string }>(() =>
      supabase.from('enrollments').select('id, student_id').eq('circle_id', activeCircleId),
    );
    let ids = enrolled.map((e) => e.student_id);
    if (studentIds) ids = ids.filter((id) => studentIds!.has(id));

    if (!ids.length) {
      setRows([]);
      return;
    }

    type Log = { student_id: string; outcome: ContactOutcome; contacted_at: string };
    const [people, logs] = await Promise.all([
      selectIn<Profile>('profiles', '*', 'id', ids),
      session
        ? fetchAll<Log>(
            () =>
              supabase
                .from('contacts_log')
                .select('student_id, outcome, contacted_at')
                .eq('session_id', session.id),
            'contacted_at',
          )
        : Promise.resolve([] as Log[]),
    ]);

    // مرتّبة تصاعديًا بالوقت، فآخر ما يُكتب في الخريطة هو أحدث تواصل
    const latest = new Map<string, Log>();
    for (const l of logs) latest.set(l.student_id, l);

    const list: Row[] = people.map((p) => ({
      ...p,
      outcome: latest.get(p.id)?.outcome ?? null,
      contacted_at: latest.get(p.id)?.contacted_at ?? null,
    }));

    list.sort((a, b) => ORDER[a.outcome ?? 'none'] - ORDER[b.outcome ?? 'none']);
    setRows(list);
  }, [activeCircleId, myRoleId, session]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const all = rows ?? [];
    const done = all.filter((r) => r.outcome).length;
    return {
      total: all.length,
      done,
      confirmed: all.filter((r) => r.outcome === 'confirmed').length,
      noAnswer: all.filter((r) => r.outcome === 'no_answer').length,
      left: all.length - done,
    };
  }, [rows]);

  async function record(student: Row, outcome: ContactOutcome) {
    if (!session || !profile) return;
    const { error } = await supabase.from('contacts_log').insert({
      session_id: session.id,
      student_id: student.id,
      by_profile_id: profile.id,
      outcome,
      channel: 'whatsapp',
    });
    if (error) alert(dbMessage(error));
    setWaFor(null);
    await load();
  }

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى أولًا." />;
  if (rows === null) return <Loading />;

  return (
    <>
      <PageHead
        title="قائمتي"
        sub={session ? `التأكيد لمجلس ${formatDateTime(session.held_at)}` : 'لا توجد جلسة قادمة بعد'}
        action={
          <button className="btn-primary" onClick={() => setAdding(true)}>
            + طالب
          </button>
        }
      />

      <div className="mb-3 grid grid-cols-4 gap-2">
        <Stat label="في نطاقي" value={stats.total} />
        <Stat label="مؤكد" value={stats.confirmed} tone="good" />
        <Stat label="لم يرد" value={stats.noAnswer} tone="warn" />
        <Stat label="متبقٍّ" value={stats.left} tone={stats.left ? 'bad' : 'good'} />
      </div>

      <div className="mb-4">
        <Bar value={percent(stats.done, stats.total)} />
        <p className="mt-1.5 text-xs text-ink-soft">
          تواصلت مع {stats.done} من {stats.total} ({percent(stats.done, stats.total)}٪)
        </p>
      </div>

      {rows.length === 0 ? (
        <Empty
          title="قائمتك فارغة"
          hint="أضف طالبًا بزر «+ طالب»، أو اطلب من مدير المنصة أن يُسنِد لك طلابًا."
        />
      ) : (
        <div className="space-y-2">
          {rows.map((r) => (
            <PersonCard key={r.id} row={r} onWhatsApp={() => setWaFor(r)} onRecord={(o) => void record(r, o)} />
          ))}
        </div>
      )}

      {waFor && (
        <WaSheet
          row={waFor}
          circleName={circle?.name ?? ''}
          when={session ? formatDateTime(session.held_at) : ''}
          where={circle?.location ?? ''}
          templates={templates}
          onClose={() => setWaFor(null)}
          onRecord={(o) => void record(waFor, o)}
        />
      )}

      {adding && (
        <AddStudent
          circleId={activeCircleId}
          onClose={() => {
            setAdding(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function PersonCard({
  row,
  onWhatsApp,
  onRecord,
}: {
  row: Row;
  onWhatsApp: () => void;
  onRecord: (o: ContactOutcome) => void;
}) {
  const tone =
    row.outcome === 'confirmed'
      ? 'good'
      : row.outcome === 'no_answer'
        ? 'warn'
        : row.outcome
          ? 'neutral'
          : 'bad';

  return (
    <Card className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-semibold">{row.full_name}</span>
          <Chip tone={tone as 'good' | 'warn' | 'neutral' | 'bad'}>
            {row.outcome ? CONTACT_LABEL[row.outcome] : 'لم يُتواصل'}
          </Chip>
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-soft">
          {[row.university, row.major, row.age ? `${row.age} سنة` : null].filter(Boolean).join(' · ') ||
            'لا بيانات إضافية'}
        </p>
        {row.contacted_at && (
          <p className="text-xs text-ink-faint">آخر تواصل {relativeDay(row.contacted_at)}</p>
        )}
      </div>

      {isValidPhone(row.phone) ? (
        <button className="btn-wa px-3 py-2" onClick={onWhatsApp} title="فتح واتساب برسالة جاهزة">
          واتساب
        </button>
      ) : (
        <Chip tone="bad">لا رقم</Chip>
      )}

      {!row.outcome && (
        <button
          className="btn-ghost px-3 py-2 text-xs"
          onClick={() => onRecord('no_answer')}
          title="تسجيل سريع"
        >
          لم يرد
        </button>
      )}
    </Card>
  );
}

function WaSheet({
  row,
  circleName,
  when,
  where,
  templates,
  onClose,
  onRecord,
}: {
  row: Row;
  circleName: string;
  when: string;
  where: string;
  templates: { id: string; label: string; body: string }[];
  onClose: () => void;
  onRecord: (o: ContactOutcome) => void;
}) {
  const vars = {
    اسم_الطالب: row.full_name,
    اسم_المجلس: circleName,
    التاريخ: when,
    المكان: where,
  };
  const [text, setText] = useState(() =>
    templates.length ? fillTemplate(templates[0].body, vars) : `السلام عليكم ${row.full_name}`,
  );

  return (
    <Sheet open onClose={onClose} title={`رسالة إلى ${row.full_name}`}>
      {templates.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.id}
              className="btn-ghost px-3 py-1.5 text-xs"
              onClick={() => setText(fillTemplate(t.body, vars))}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <textarea className="field min-h-36" value={text} onChange={(e) => setText(e.target.value)} />
      <p className="mt-1.5 text-xs text-ink-soft">عدّل النص كما تشاء قبل الإرسال.</p>

      <button
        className="btn-wa mt-3 w-full"
        onClick={() => {
          if (row.phone) openWhatsApp(row.phone, text);
        }}
      >
        فتح واتساب
      </button>

      <p className="mt-5 mb-2 text-sm font-medium">بعد المحادثة، سجّل النتيجة:</p>
      <div className="grid grid-cols-3 gap-2">
        <button className="btn bg-emerald-600 py-3 text-white" onClick={() => onRecord('confirmed')}>
          مؤكد
        </button>
        <button className="btn bg-stone-500 py-3 text-white" onClick={() => onRecord('apologized')}>
          معتذر
        </button>
        <button className="btn bg-amber-500 py-3 text-white" onClick={() => onRecord('no_answer')}>
          لم يرد
        </button>
      </div>
    </Sheet>
  );
}

function AddStudent({ circleId, onClose }: { circleId: string; onClose: () => void }) {
  const [draft, setDraft] = useState({
    full_name: '',
    phone: '',
    age: '',
    university: '',
    major: '',
    city: '',
    source: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!draft.full_name.trim()) {
      setError('الاسم مطلوب.');
      return;
    }
    setSaving(true);
    setError(null);

    const age = draft.age ? Number(draft.age) : null;
    if (age != null && !(Number.isInteger(age) && age >= 5 && age <= 120)) {
      setError('السن بين ٥ و١٢٠.');
      setSaving(false);
      return;
    }

    // طالب بلا حساب دخول: القاعدة تنشئ ملفه وانتسابه وتُدخله نطاق مسؤول التواصل معًا.
    const { error: e1 } = await supabase.rpc('add_student', {
      p_circle: circleId,
      p_full_name: draft.full_name.trim(),
      p_phone: draft.phone || null,
      p_age: age,
      p_university: draft.university || null,
      p_major: draft.major || null,
      p_city: draft.city || null,
      p_source: draft.source || null,
    });

    setSaving(false);
    if (e1) {
      setError(dbMessage(e1));
      return;
    }
    onClose();
  }

  // حقول عادية لا حفظ تلقائي: النموذج يُرسَل مرة واحدة، والتأخير كان يضيّع آخر ما كُتب.
  const field = (k: keyof typeof draft, label: string, extra: { type?: string; dir?: 'ltr' } = {}) => (
    <div>
      <label className="label">{label}</label>
      <input
        className="field"
        type={extra.type ?? 'text'}
        dir={extra.dir}
        value={draft[k]}
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
      />
    </div>
  );

  return (
    <Sheet open onClose={onClose} title="إضافة طالب">
      <div className="space-y-3">
        {field('full_name', 'الاسم الكامل')}
        {field('phone', 'رقم الهاتف', { type: 'tel', dir: 'ltr' })}
        <div className="grid grid-cols-2 gap-3">
          {field('age', 'السن', { type: 'number' })}
          {field('city', 'المدينة')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('university', 'الجامعة')}
          {field('major', 'التخصص')}
        </div>
        {field('source', 'كيف عرف المجلس؟')}
      </div>

      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}

      <button className="btn-primary mt-4 w-full" disabled={saving} onClick={() => void submit()}>
        {saving ? 'جارٍ الحفظ…' : 'إضافة للمجلس'}
      </button>
    </Sheet>
  );
}
