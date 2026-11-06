import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { useApp } from '@/store/session';
import { Card, Chip, Empty, Loading, PageHead, Sheet } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { ROLE_LABEL, type Profile, type RoleKey, type Session } from '@/lib/types';

const ASSIGNABLE: RoleKey[] = [
  'contact_officer',
  'attendance_officer',
  'finance_officer',
  'tasks_officer',
  'transcription_officer',
  'member',
  'admin',
];

interface RoleRow {
  id: string;
  profile_id: string;
  role: RoleKey;
  full_name: string;
  scope: number;
}

export default function Admin() {
  const { profile, activeCircleId } = useApp();
  const [tab, setTab] = useState<'roles' | 'sessions'>('roles');
  const [roleRows, setRoleRows] = useState<RoleRow[] | null>(null);
  const [people, setPeople] = useState<Profile[]>([]);
  const [candidates, setCandidates] = useState<Profile[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [granting, setGranting] = useState(false);
  const [scopeFor, setScopeFor] = useState<RoleRow | null>(null);
  const [newSession, setNewSession] = useState(false);

  const load = useCallback(async () => {
    if (!activeCircleId) return;
    setRoleRows(null);

    const [{ data: roles }, enrolled, { data: sess }, visible] = await Promise.all([
      supabase.from('roles').select('id, profile_id, role').eq('circle_id', activeCircleId).is('revoked_at', null),
      fetchAll<{ student_id: string }>(() =>
        supabase.from('enrollments').select('id, student_id').eq('circle_id', activeCircleId),
      ),
      supabase
        .from('sessions')
        .select('*')
        .eq('circle_id', activeCircleId)
        .order('held_at', { ascending: false })
        .limit(10),
      // القاعدة تُرجع أهل مجالسي، والحسابات الجديدة التي لم تُضمّ لمجلس بعد
      fetchAll<Profile>(() => supabase.from('profiles').select('*')),
    ]);

    const ids = new Set<string>([
      ...(roles ?? []).map((r) => r.profile_id as string),
      ...enrolled.map((e) => e.student_id),
    ]);

    const profs = visible.filter((p) => ids.has(p.id));
    const names = new Map(profs.map((p) => [p.id, p.full_name]));

    const roleIds = (roles ?? []).map((r) => r.id as string);
    const assigns = await selectIn<{ role_id: string }>('assignments', 'id, role_id', 'role_id', roleIds, (q) =>
      q.is('revoked_at', null),
    );

    const counts = new Map<string, number>();
    for (const a of assigns) counts.set(a.role_id, (counts.get(a.role_id) ?? 0) + 1);

    setRoleRows(
      (roles ?? []).map((r) => ({
        id: r.id as string,
        profile_id: r.profile_id as string,
        role: r.role as RoleKey,
        full_name: names.get(r.profile_id as string) ?? '—',
        scope: counts.get(r.id as string) ?? 0,
      })),
    );
    // النطاق من طلاب المجلس فقط، والإسناد لأي شخص مرئي (منهم الحسابات الجديدة)
    const studentSet = new Set(enrolled.map((e) => e.student_id));
    setPeople(profs.filter((p) => studentSet.has(p.id)));
    setCandidates([...visible].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar')));
    setSessions((sess ?? []) as Session[]);
  }, [activeCircleId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(row: RoleRow) {
    if (!confirm(`سحب دور «${ROLE_LABEL[row.role]}» من ${row.full_name}؟`)) return;
    await supabase.from('roles').update({ revoked_at: new Date().toISOString() }).eq('id', row.id);
    await load();
  }

  if (!activeCircleId) return <Empty title="لا يوجد مجلس نشط" hint="اختر مجلسًا من الأعلى." />;
  if (roleRows === null) return <Loading />;

  return (
    <>
      <PageHead title="لوحة الإدارة" sub="إسناد الأدوار والنطاقات، وإنشاء الجلسات" />

      <div className="mb-4 flex gap-2">
        <button
          className={`btn px-4 py-2 text-sm ${tab === 'roles' ? 'bg-brand-700 text-white' : 'border border-line bg-white'}`}
          onClick={() => setTab('roles')}
        >
          الأدوار
        </button>
        <button
          className={`btn px-4 py-2 text-sm ${tab === 'sessions' ? 'bg-brand-700 text-white' : 'border border-line bg-white'}`}
          onClick={() => setTab('sessions')}
        >
          الجلسات
        </button>
      </div>

      {tab === 'roles' ? (
        <>
          <button className="btn-primary mb-3 w-full" onClick={() => setGranting(true)}>
            + إسناد دور
          </button>

          {roleRows.length === 0 ? (
            <Empty title="لم تُسنَد أدوار بعد" hint="ابدأ بإسناد مسؤول تواصل ومسؤول حضور." />
          ) : (
            <div className="space-y-2">
              {roleRows.map((r) => (
                <Card key={r.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{r.full_name}</p>
                    <p className="text-xs text-ink-soft">{ROLE_LABEL[r.role]}</p>
                  </div>
                  <Chip tone={r.scope ? 'info' : 'warn'}>{r.scope} في نطاقه</Chip>
                  <button className="btn-ghost px-3 py-2 text-xs" onClick={() => setScopeFor(r)}>
                    النطاق
                  </button>
                  <button
                    className="btn-ghost px-3 py-2 text-xs text-rose-700"
                    onClick={() => void revoke(r)}
                  >
                    سحب
                  </button>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <button className="btn-primary mb-3 w-full" onClick={() => setNewSession(true)}>
            + جلسة جديدة
          </button>
          {sessions.length === 0 ? (
            <Empty title="لا جلسات" hint="أنشئ جلسة ليبدأ التواصل والحضور." />
          ) : (
            <div className="space-y-2">
              {sessions.map((s) => (
                <Card key={s.id} className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{s.title || 'مجلس'}</p>
                    <p className="text-xs text-ink-soft">{formatDateTime(s.held_at)}</p>
                  </div>
                  <Chip tone={s.status === 'closed' ? 'neutral' : 'good'}>
                    {s.status === 'closed' ? 'مغلق' : s.status === 'open' ? 'جارٍ' : 'مجدول'}
                  </Chip>
                </Card>
              ))}
            </div>
          )}
        </>
      )}

      {granting && (
        <GrantRole
          circleId={activeCircleId}
          people={candidates}
          grantedBy={profile?.id ?? null}
          onClose={() => {
            setGranting(false);
            void load();
          }}
        />
      )}

      {scopeFor && (
        <ScopeSheet
          row={scopeFor}
          people={people}
          assignedBy={profile?.id ?? null}
          onClose={() => {
            setScopeFor(null);
            void load();
          }}
        />
      )}

      {newSession && (
        <NewSession
          circleId={activeCircleId}
          onClose={() => {
            setNewSession(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function GrantRole({
  circleId,
  people,
  grantedBy,
  onClose,
}: {
  circleId: string;
  people: Profile[];
  grantedBy: string | null;
  onClose: () => void;
}) {
  const [who, setWho] = useState('');
  const [role, setRole] = useState<RoleKey>('contact_officer');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!who) {
      setErr('اختر الشخص أولًا.');
      return;
    }
    const { error } = await supabase
      .from('roles')
      .insert({ profile_id: who, circle_id: circleId, role, granted_by: grantedBy });
    if (error) setErr(error.message);
    else onClose();
  }

  return (
    <Sheet open onClose={onClose} title="إسناد دور">
      <label className="label">الشخص</label>
      <select className="field" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">— اختر —</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>

      <label className="label mt-4">الدور</label>
      <select className="field" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
        {ASSIGNABLE.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>

      {err && <p className="mt-3 text-sm text-rose-700">{err}</p>}
      <button className="btn-primary mt-4 w-full" onClick={() => void submit()}>
        إسناد
      </button>
    </Sheet>
  );
}

function ScopeSheet({
  row,
  people,
  assignedBy,
  onClose,
}: {
  row: RoleRow;
  people: Profile[];
  assignedBy: string | null;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('assignments')
        .select('student_id')
        .eq('role_id', row.id)
        .is('revoked_at', null);
      setSelected(new Set((data ?? []).map((a) => a.student_id as string)));
      setLoading(false);
    })();
  }, [row.id]);

  async function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
      await supabase
        .from('assignments')
        .update({ revoked_at: new Date().toISOString() })
        .eq('role_id', row.id)
        .eq('student_id', id);
    } else {
      next.add(id);
      await supabase
        .from('assignments')
        .upsert(
          { role_id: row.id, student_id: id, assigned_by: assignedBy, revoked_at: null },
          { onConflict: 'role_id,student_id' },
        );
    }
    setSelected(next);
  }

  return (
    <Sheet open onClose={onClose} title={`نطاق ${row.full_name}`}>
      <p className="mb-3 text-sm text-ink-soft">
        {ROLE_LABEL[row.role]} — يُقاس أداؤه بما أُسنِد إليه هنا فقط.
      </p>
      {loading ? (
        <Loading />
      ) : (
        <div className="max-h-96 space-y-1.5 overflow-y-auto">
          {people.map((p) => (
            <button
              key={p.id}
              onClick={() => void toggle(p.id)}
              className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-2.5 text-start ${
                selected.has(p.id) ? 'border-brand-600 bg-brand-50' : 'border-line bg-white'
              }`}
            >
              <span className="truncate">{p.full_name}</span>
              {selected.has(p.id) && <Chip tone="good">في نطاقه</Chip>}
            </button>
          ))}
        </div>
      )}
      <button className="btn-primary mt-4 w-full" onClick={onClose}>
        تم
      </button>
    </Sheet>
  );
}

function NewSession({ circleId, onClose }: { circleId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!when) {
      setErr('حدد موعد المجلس.');
      return;
    }
    const { error } = await supabase.from('sessions').insert({
      circle_id: circleId,
      title: title || null,
      held_at: new Date(when).toISOString(),
      status: 'scheduled',
    });
    if (error) setErr(error.message);
    else onClose();
  }

  return (
    <Sheet open onClose={onClose} title="جلسة جديدة">
      <label className="label">عنوان المجلس (اختياري)</label>
      <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />

      <label className="label mt-4">الموعد</label>
      <input
        className="field"
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
      />

      {err && <p className="mt-3 text-sm text-rose-700">{err}</p>}
      <button className="btn-primary mt-4 w-full" onClick={() => void submit()}>
        إنشاء
      </button>
    </Sheet>
  );
}
