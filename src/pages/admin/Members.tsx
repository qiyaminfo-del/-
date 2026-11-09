import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, KeyRound, Plus, ShieldOff, ShieldCheck, UserPlus, Wand2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { fetchAll, selectIn } from '@/lib/query';
import { dbMessage } from '@/lib/errors';
import { membersApi } from '@/lib/membersApi';
import { STAFF_ROLES, normalizeUsername, passwordError, usernameError } from '@/lib/members';
import { useApp } from '@/store/session';
import { Card, Chip, Empty, Loading, Sheet } from '@/components/ui';
import { ROLE_LABEL, type Assignment, type Profile, type RoleKey, type StudentGroup } from '@/lib/types';
import { SCOPED_ROLES, loadGroups, loadStudents, type StudentLite } from './shared';

interface RoleRow {
  id: string;
  profile_id: string;
  role: RoleKey;
  scope_all: boolean;
  revoked_at: string | null;
}

interface Person {
  profile: Profile;
  roles: RoleRow[]; // النشطة فقط
}

export default function Members({ circleId }: { circleId: string }) {
  const me = useApp((s) => s.profile);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [allRoles, setAllRoles] = useState<RoleRow[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [students, setStudents] = useState<StudentLite[]>([]);
  const [groups, setGroups] = useState<StudentGroup[]>([]);
  const [candidates, setCandidates] = useState<Profile[]>([]);
  const [adding, setAdding] = useState(false);
  const [granting, setGranting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data: roleData, error: rErr } = await supabase
      .from('roles')
      .select('id, profile_id, role, scope_all, revoked_at')
      .eq('circle_id', circleId);
    if (rErr) {
      setError(dbMessage(rErr));
      setPeople([]);
      return;
    }
    const roles = (roleData ?? []) as RoleRow[];
    const active = roles.filter((r) => !r.revoked_at);
    const ids = [...new Set(active.map((r) => r.profile_id))];

    const [profs, assigns, studs, grps, visible] = await Promise.all([
      selectIn<Profile>('profiles', '*', 'id', ids),
      selectIn<Assignment>('assignments', '*', 'role_id', roles.map((r) => r.id)),
      loadStudents(circleId),
      loadGroups(circleId),
      fetchAll<Profile>(() => supabase.from('profiles').select('*')),
    ]);

    const byProfile = new Map<string, RoleRow[]>();
    for (const r of active) byProfile.set(r.profile_id, [...(byProfile.get(r.profile_id) ?? []), r]);
    setPeople(
      profs
        .map((p) => ({ profile: p, roles: byProfile.get(p.id) ?? [] }))
        .sort((a, b) => a.profile.full_name.localeCompare(b.profile.full_name, 'ar')),
    );
    setAllRoles(roles);
    setAssignments(assigns);
    setStudents(studs);
    setGroups(grps);
    setCandidates(visible.sort((a, b) => a.full_name.localeCompare(b.full_name, 'ar')));
  }, [circleId]);

  useEffect(() => {
    setPeople(null);
    void load();
  }, [load]);

  const scopeLabel = useCallback(
    (r: RoleRow) => {
      if (!SCOPED_ROLES.includes(r.role)) return null;
      if (r.scope_all) return 'كل الطلاب';
      const mine = assignments.filter((a) => a.role_id === r.id && !a.revoked_at);
      const g = mine.filter((a) => a.group_id).length;
      const s = mine.filter((a) => a.student_id).length;
      if (!g && !s) return 'بلا نطاق';
      return [g ? `${g} مجموعة` : '', s ? `${s} طالب` : ''].filter(Boolean).join(' · ');
    },
    [assignments],
  );

  const open = people?.find((p) => p.profile.id === openId) ?? null;

  if (people === null) return <Loading />;

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <button className="btn-primary" onClick={() => setAdding(true)}>
          <UserPlus size={17} />
          عضو جديد
        </button>
        <button className="btn-ghost" onClick={() => setGranting(true)}>
          <Plus size={17} />
          دور لحساب موجود
        </button>
      </div>

      {error && <p className="mb-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}

      {people.length === 0 ? (
        <Empty title="لا أعضاء بعد" hint="أضف أول عضو بزر «عضو جديد»، وحدد اسم المستخدم وكلمة المرور وأدواره." />
      ) : (
        <div className="space-y-2.5">
          {people.map(({ profile: p, roles }) => (
            <button
              key={p.id}
              onClick={() => setOpenId(p.id)}
              className={`card-link flex w-full items-center gap-4 p-4 text-start ${p.disabled_at ? 'opacity-60' : ''}`}
            >
              <span className="display grid h-11 w-11 shrink-0 place-items-center rounded-full bg-brand-50 text-xl text-brand-800 ring-1 ring-brand-200">
                {p.full_name.trim().charAt(0) || '؟'}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{p.full_name}</span>
                  {p.username && (
                    <span className="text-xs text-ink-faint" dir="ltr">
                      @{p.username}
                    </span>
                  )}
                  {p.disabled_at && <Chip tone="bad">معطّل</Chip>}
                  {p.id === me?.id && <Chip tone="info">أنت</Chip>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {roles.map((r) => (
                    <span key={r.id} className="chip bg-stone-100 text-stone-700 ring-1 ring-inset ring-stone-200">
                      {ROLE_LABEL[r.role]}
                      {scopeLabel(r) && <span className="text-ink-faint">· {scopeLabel(r)}</span>}
                    </span>
                  ))}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {adding && (
        <AddMember
          circleId={circleId}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            void load();
          }}
        />
      )}

      {granting && (
        <GrantExisting
          circleId={circleId}
          candidates={candidates}
          grantedBy={me?.id ?? null}
          onClose={() => {
            setGranting(false);
            void load();
          }}
        />
      )}

      {open && (
        <MemberSheet
          circleId={circleId}
          person={open}
          isSelf={open.profile.id === me?.id}
          allRoles={allRoles.filter((r) => r.profile_id === open.profile.id)}
          assignments={assignments}
          students={students}
          groups={groups}
          grantedBy={me?.id ?? null}
          onChanged={() => void load()}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}

/* ---------- عضو جديد (عبر الخادم: الحساب وكلمة المرور) ---------- */
function AddMember({ circleId, onClose, onCreated }: { circleId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [roles, setRoles] = useState<Set<RoleKey>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const toggle = (r: RoleKey) =>
    setRoles((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });

  function generate() {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.getRandomValues(new Uint8Array(12));
    setPassword(Array.from(bytes, (b) => chars[b % chars.length]).join(''));
    setShow(true);
  }

  async function submit() {
    setError(null);
    if (!name.trim()) return setError('اكتب الاسم الكامل.');
    const uErr = usernameError(username);
    if (uErr) return setError(uErr);
    const pErr = passwordError(password);
    if (pErr) return setError(pErr);
    if (!roles.size) return setError('اختر دورًا واحدًا على الأقل.');

    setBusy(true);
    const res = await membersApi({
      action: 'create',
      circle_id: circleId,
      full_name: name.trim(),
      username: normalizeUsername(username),
      password,
      roles: [...roles],
    });
    setBusy(false);
    if (res.error) return setError(res.error);
    setPassword(''); // لا تبقى كلمة المرور في الذاكرة بعد الحفظ
    setDone(normalizeUsername(username));
  }

  if (done) {
    return (
      <Sheet open onClose={onCreated} title="تمت إضافة العضو">
        <div className="rounded-2xl bg-emerald-50 p-5 text-center ring-1 ring-inset ring-emerald-200">
          <p className="font-semibold">{name}</p>
          <p className="mt-1 text-sm text-ink-soft">
            يدخل باسم المستخدم:{' '}
            <span className="font-semibold text-ink" dir="ltr">
              {done}
            </span>
          </p>
          <p className="mt-3 text-xs text-ink-faint">كلمة المرور لا تُعرض بعد الحفظ. أبلغها له بنفسك، ويمكنك تغييرها لاحقًا.</p>
        </div>
        <button className="btn-primary mt-4 w-full" onClick={onCreated}>
          تم
        </button>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title="عضو جديد">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="m-name">الاسم الكامل</label>
          <input id="m-name" className="field" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label" htmlFor="m-user">اسم المستخدم (للدخول)</label>
          <input
            id="m-user"
            className="field"
            dir="ltr"
            autoComplete="off"
            maxLength={32}
            placeholder="hesham.a"
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
          />
          <p className="mt-1 text-xs text-ink-faint">حروف لاتينية صغيرة وأرقام و . _ - من ٣ إلى ٣٢.</p>
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label className="label" htmlFor="m-pass">كلمة المرور</label>
            <button type="button" onClick={generate} className="flex items-center gap-1 text-xs text-brand-700 hover:underline">
              <Wand2 size={13} />
              توليد كلمة قوية
            </button>
          </div>
          <div className="relative">
            <input
              id="m-pass"
              className="field pe-11"
              dir="ltr"
              type={show ? 'text' : 'password'}
              autoComplete="new-password"
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              className="absolute end-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-ink-faint hover:text-ink"
            >
              {show ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>
        <fieldset>
          <legend className="label">الأدوار (يمكن أكثر من دور)</legend>
          <div className="grid grid-cols-2 gap-2">
            {STAFF_ROLES.map((r) => (
              <label
                key={r}
                className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2.5 text-sm transition ${
                  roles.has(r) ? 'border-brand-500 bg-brand-50 text-brand-900' : 'border-line bg-white hover:bg-stone-50'
                }`}
              >
                <input type="checkbox" className="accent-brand-700" checked={roles.has(r)} onChange={() => toggle(r)} />
                {ROLE_LABEL[r]}
              </label>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">
            الشيخ ومسؤول الحضور يبدآن بنطاق «كل الطلاب»، والبقية بلا نطاق حتى تحدده من بطاقة العضو.
          </p>
        </fieldset>
      </div>

      {error && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}

      <button className="btn-primary mt-5 w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? 'جارٍ الإنشاء…' : 'إنشاء الحساب'}
      </button>
    </Sheet>
  );
}

/* ---------- بطاقة العضو: الأدوار والنطاق والحساب ---------- */
function MemberSheet({
  circleId,
  person,
  isSelf,
  allRoles,
  assignments,
  students,
  groups,
  grantedBy,
  onChanged,
  onClose,
}: {
  circleId: string;
  person: Person;
  isSelf: boolean;
  allRoles: RoleRow[];
  assignments: Assignment[];
  students: StudentLite[];
  groups: StudentGroup[];
  grantedBy: string | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const p = person.profile;
  const [name, setName] = useState(p.full_name);
  const [newPass, setNewPass] = useState('');
  const [msg, setMsg] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [scopeRole, setScopeRole] = useState<RoleRow | null>(null);

  const activeByRole = useMemo(() => new Map(person.roles.map((r) => [r.role, r])), [person.roles]);
  const say = (tone: 'good' | 'bad', text: string) => setMsg({ tone, text });

  async function toggleRole(role: RoleKey) {
    setBusy(role);
    setMsg(null);
    const active = activeByRole.get(role);
    const { error } = active
      ? await supabase.from('roles').update({ revoked_at: new Date().toISOString() }).eq('id', active.id)
      : await supabase
          .from('roles')
          .upsert(
            { profile_id: p.id, circle_id: circleId, role, granted_by: grantedBy, revoked_at: null },
            { onConflict: 'profile_id,circle_id,role' },
          );
    setBusy(null);
    if (error) say('bad', dbMessage(error));
    onChanged();
  }

  async function saveName() {
    if (!name.trim() || name.trim() === p.full_name) return;
    const { error } = await supabase.from('profiles').update({ full_name: name.trim() }).eq('id', p.id);
    if (error) say('bad', dbMessage(error));
    else {
      say('good', 'حُفظ الاسم.');
      onChanged();
    }
  }

  async function resetPassword() {
    const err = passwordError(newPass);
    if (err) return say('bad', err);
    setBusy('pass');
    const res = await membersApi({ action: 'set_password', target_id: p.id, password: newPass });
    setBusy(null);
    setNewPass('');
    if (res.error) say('bad', res.error);
    else say('good', 'غُيّرت كلمة المرور. أبلغها للعضو بنفسك.');
  }

  async function setDisabled(disabled: boolean) {
    if (disabled && !confirm(`تعطيل حساب ${p.full_name}؟ يفقد كل صلاحياته ولا يستطيع الدخول.`)) return;
    setBusy('disable');
    const res = await membersApi<{ warning?: string }>({ action: 'set_disabled', target_id: p.id, disabled });
    setBusy(null);
    if (res.error) say('bad', res.error);
    else {
      say(res.data?.warning ? 'bad' : 'good', res.data?.warning ?? (disabled ? 'عُطّل الحساب.' : 'فُعّل الحساب.'));
      onChanged();
    }
  }

  const scopeRow = scopeRole ? allRoles.find((r) => r.id === scopeRole.id) ?? scopeRole : null;

  return (
    <Sheet open onClose={onClose} title={p.full_name}>
      {msg && (
        <p
          role="status"
          className={`mb-4 rounded-xl px-3.5 py-2.5 text-sm ring-1 ring-inset ${
            msg.tone === 'good' ? 'bg-emerald-50 text-emerald-800 ring-emerald-200' : 'bg-rose-50 text-rose-800 ring-rose-200'
          }`}
        >
          {msg.text}
        </p>
      )}

      <section className="mb-6">
        <label className="label" htmlFor="ms-name">الاسم</label>
        <div className="flex gap-2">
          <input id="ms-name" className="field" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-ghost shrink-0" onClick={() => void saveName()} disabled={!name.trim() || name.trim() === p.full_name}>
            حفظ
          </button>
        </div>
        {p.username && (
          <p className="mt-1.5 text-xs text-ink-soft">
            اسم المستخدم:{' '}
            <span dir="ltr" className="font-medium text-ink">
              {p.username}
            </span>
          </p>
        )}
      </section>

      <section className="mb-6">
        <h3 className="display mb-2 text-xl">الأدوار والنطاق</h3>
        <div className="space-y-1.5">
          {STAFF_ROLES.map((role) => {
            const active = activeByRole.get(role);
            const lockSelfAdmin = isSelf && role === 'admin';
            return (
              <div key={role} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    className="accent-brand-700"
                    checked={Boolean(active)}
                    disabled={busy === role || lockSelfAdmin}
                    onChange={() => void toggleRole(role)}
                  />
                  {ROLE_LABEL[role]}
                </label>
                {active && SCOPED_ROLES.includes(role) && (
                  <button className="btn-ghost px-2.5 py-1.5 text-xs" onClick={() => setScopeRole(active)}>
                    النطاق: {active.scope_all ? 'كل الطلاب' : scopeSummary(active.id, assignments)}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {isSelf && <p className="mt-1.5 text-xs text-ink-faint">لا يمكنك سحب دور المدير من نفسك.</p>}
      </section>

      {!isSelf && (
        <section>
          <h3 className="display mb-2 text-xl">الحساب</h3>
          {p.username ? (
            <div className="mb-3 flex gap-2">
              <input
                className="field"
                dir="ltr"
                type="password"
                autoComplete="new-password"
                placeholder="كلمة مرور جديدة"
                aria-label="كلمة مرور جديدة"
                maxLength={72}
                value={newPass}
                onChange={(e) => setNewPass(e.target.value)}
              />
              <button className="btn-ghost shrink-0" disabled={busy === 'pass' || !newPass} onClick={() => void resetPassword()}>
                <KeyRound size={16} />
                تغيير
              </button>
            </div>
          ) : (
            <p className="mb-3 text-xs text-ink-faint">هذا حساب أنشأه صاحبه ببريده؛ يغيّر كلمة مروره بنفسه.</p>
          )}
          {p.disabled_at ? (
            <button className="btn-ghost w-full" disabled={busy === 'disable'} onClick={() => void setDisabled(false)}>
              <ShieldCheck size={16} />
              تفعيل الحساب
            </button>
          ) : (
            <button
              className="btn-ghost w-full text-rose-700 hover:border-rose-200 hover:bg-rose-50"
              disabled={busy === 'disable'}
              onClick={() => void setDisabled(true)}
            >
              <ShieldOff size={16} />
              تعطيل الحساب
            </button>
          )}
        </section>
      )}

      {scopeRow && (
        <ScopeSheet
          role={scopeRow}
          personName={p.full_name}
          assignments={assignments.filter((a) => a.role_id === scopeRow.id)}
          students={students}
          groups={groups}
          grantedBy={grantedBy}
          onChanged={onChanged}
          onClose={() => setScopeRole(null)}
        />
      )}
    </Sheet>
  );
}

function scopeSummary(roleId: string, assignments: Assignment[]) {
  const mine = assignments.filter((a) => a.role_id === roleId && !a.revoked_at);
  const g = mine.filter((a) => a.group_id).length;
  const s = mine.filter((a) => a.student_id).length;
  if (!g && !s) return 'لم يُحدَّد';
  return [g ? `${g} مجموعة` : '', s ? `${s} طالب` : ''].filter(Boolean).join(' · ');
}

/* ---------- نطاق الدور: كل الطلاب، أو مجموعات وطلاب محددون ---------- */
function ScopeSheet({
  role,
  personName,
  assignments,
  students,
  groups,
  grantedBy,
  onChanged,
  onClose,
}: {
  role: RoleRow;
  personName: string;
  assignments: Assignment[];
  students: StudentLite[];
  groups: StudentGroup[];
  grantedBy: string | null;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [all, setAll] = useState(role.scope_all);
  const [rows, setRows] = useState(assignments);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const activeStudent = new Set(rows.filter((a) => !a.revoked_at && a.student_id).map((a) => a.student_id));
  const activeGroup = new Set(rows.filter((a) => !a.revoked_at && a.group_id).map((a) => a.group_id));

  async function setScopeAll(value: boolean) {
    setError(null);
    const { error: e } = await supabase.from('roles').update({ scope_all: value }).eq('id', role.id);
    if (e) return setError(dbMessage(e));
    setAll(value);
    onChanged();
  }

  async function toggle(kind: 'student_id' | 'group_id', targetId: string) {
    setError(null);
    const existing = rows.find((a) => a[kind] === targetId);
    const isOn = existing && !existing.revoked_at;
    let res;
    if (existing) {
      res = await supabase
        .from('assignments')
        .update({ revoked_at: isOn ? new Date().toISOString() : null, assigned_by: grantedBy })
        .eq('id', existing.id)
        .select('*')
        .single();
    } else {
      res = await supabase
        .from('assignments')
        .insert({ role_id: role.id, [kind]: targetId, assigned_by: grantedBy })
        .select('*')
        .single();
    }
    if (res.error) return setError(dbMessage(res.error));
    const row = res.data as Assignment;
    setRows((prev) => (existing ? prev.map((a) => (a.id === row.id ? row : a)) : [...prev, row]));
    onChanged();
  }

  const shown = students.filter((s) => !filter.trim() || s.full_name.includes(filter.trim()));

  return (
    <Sheet open onClose={onClose} title={`نطاق ${ROLE_LABEL[role.role]}`}>
      <p className="mb-4 text-sm text-ink-soft">
        {personName} — يرى ويتحكم فقط في الطلاب الذين تحددهم هنا.
      </p>

      <div className="mb-5 grid grid-cols-2 gap-2">
        {[
          [true, 'كل طلاب المجلس'],
          [false, 'مجموعات أو طلاب محددون'],
        ].map(([v, label]) => (
          <button
            key={String(v)}
            onClick={() => void setScopeAll(v as boolean)}
            className={`rounded-xl border px-3 py-3 text-sm transition ${
              all === v ? 'border-brand-600 bg-brand-50 font-semibold text-brand-900' : 'border-line bg-white hover:bg-stone-50'
            }`}
          >
            {label as string}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}

      {!all && (
        <>
          <h4 className="mb-2 text-sm font-semibold">المجموعات</h4>
          {groups.length === 0 ? (
            <p className="mb-4 text-xs text-ink-faint">لا مجموعات بعد. أنشئها من تبويب «المجموعات».</p>
          ) : (
            <div className="mb-5 flex flex-wrap gap-2">
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => void toggle('group_id', g.id)}
                  aria-pressed={activeGroup.has(g.id)}
                  className={`chip border px-3 py-1.5 text-sm ${
                    activeGroup.has(g.id) ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-line bg-white'
                  }`}
                >
                  {g.name}
                </button>
              ))}
            </div>
          )}

          <h4 className="mb-2 text-sm font-semibold">طلاب بأسمائهم</h4>
          <input
            className="field mb-2"
            placeholder="بحث بالاسم"
            aria-label="بحث عن طالب"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {shown.map((s) => (
              <label
                key={s.id}
                className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2 text-sm ${
                  activeStudent.has(s.id) ? 'border-brand-500 bg-brand-50' : 'border-line bg-white'
                }`}
              >
                <input
                  type="checkbox"
                  className="accent-brand-700"
                  checked={activeStudent.has(s.id)}
                  onChange={() => void toggle('student_id', s.id)}
                />
                {s.full_name}
              </label>
            ))}
            {shown.length === 0 && <p className="py-4 text-center text-xs text-ink-faint">لا طلاب مطابقون.</p>}
          </div>
        </>
      )}

      <button className="btn-primary mt-5 w-full" onClick={onClose}>
        تم
      </button>
    </Sheet>
  );
}

/* ---------- دور لحساب موجود (حساب سجّله صاحبه بنفسه) ---------- */
function GrantExisting({
  circleId,
  candidates,
  grantedBy,
  onClose,
}: {
  circleId: string;
  candidates: Profile[];
  grantedBy: string | null;
  onClose: () => void;
}) {
  const [who, setWho] = useState('');
  const [role, setRole] = useState<RoleKey>('contact_officer');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!who) return setErr('اختر الشخص أولًا.');
    const { error } = await supabase
      .from('roles')
      .upsert(
        { profile_id: who, circle_id: circleId, role, granted_by: grantedBy, revoked_at: null },
        { onConflict: 'profile_id,circle_id,role' },
      );
    if (error) setErr(dbMessage(error));
    else onClose();
  }

  return (
    <Sheet open onClose={onClose} title="دور لحساب موجود">
      <p className="mb-4 text-sm text-ink-soft">لمن أنشأ حسابه بنفسه (طالب) وتريد إسناد مسؤولية له.</p>
      <label className="label" htmlFor="g-who">الشخص</label>
      <select id="g-who" className="field" value={who} onChange={(e) => setWho(e.target.value)}>
        <option value="">— اختر —</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.full_name}
          </option>
        ))}
      </select>
      <label className="label mt-4" htmlFor="g-role">الدور</label>
      <select id="g-role" className="field" value={role} onChange={(e) => setRole(e.target.value as RoleKey)}>
        {STAFF_ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      {err && <p className="mt-3 text-sm text-rose-700">{err}</p>}
      <Card className="mt-4 bg-stone-50 text-xs text-ink-soft">
        إن لم يظهر الشخص، فهو غير مرئي لك (منتسب لمجلس آخر). اطلب منه الانتساب أولًا.
      </Card>
      <button className="btn-primary mt-4 w-full" onClick={() => void submit()}>
        إسناد
      </button>
    </Sheet>
  );
}
