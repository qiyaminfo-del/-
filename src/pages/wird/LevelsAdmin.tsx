import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dbMessage } from '@/lib/errors';
import { Chip, Empty, Sheet } from '@/components/ui';
import { WIRD_KIND_LABEL, type WirdKind, type WirdLevel } from '@/lib/types';
import type { WirdCatalog } from './data';

/** إدارة العبادات والمستويات (المدير والشيخ) */
export default function LevelsAdmin({
  circleId,
  catalog,
  onChanged,
}: {
  circleId: string;
  catalog: WirdCatalog;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState(false);
  const [editingLevel, setEditingLevel] = useState<WirdLevel | 'new' | null>(null);

  async function toggleActive(id: string, is_active: boolean) {
    const { error: e } = await supabase.from('worship_items').update({ is_active }).eq('id', id);
    if (e) setError(dbMessage(e));
    onChanged();
  }

  return (
    <div className="space-y-8">
      {error && <p className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{error}</p>}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="display text-2xl">العبادات</h3>
          <button className="btn-ghost px-3 py-2 text-sm" onClick={() => setAddingItem(true)}>
            <Plus size={16} />
            عبادة
          </button>
        </div>
        {catalog.items.length === 0 ? (
          <Empty title="لا عبادات بعد" hint="ابدأ بالصلوات الخمس (تم/لم يتم)، ثم القرآن (عدد صفحات)، والأذكار وغيرها." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {catalog.items.map((i) => (
              <span
                key={i.id}
                className={`chip gap-2 border px-3 py-1.5 text-sm ${i.is_active ? 'border-line bg-white' : 'border-dashed border-stone-300 bg-stone-50 text-ink-faint'}`}
              >
                {i.name}
                <span className="text-xs text-ink-faint">
                  {WIRD_KIND_LABEL[i.kind]}
                  {i.unit ? ` · ${i.unit}` : ''}
                </span>
                <button className="text-xs text-brand-700 hover:underline" onClick={() => void toggleActive(i.id, !i.is_active)}>
                  {i.is_active ? 'إيقاف' : 'تفعيل'}
                </button>
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="display text-2xl">المستويات</h3>
          <button className="btn-primary px-3 py-2 text-sm" onClick={() => setEditingLevel('new')} disabled={!catalog.items.length}>
            <Plus size={16} />
            مستوى
          </button>
        </div>
        {catalog.levels.length === 0 ? (
          <Empty title="لا مستويات بعد" hint="أنشئ ما تشاء من المستويات، ولكل مستوى عباداته وأهدافها. مثال: الأول الصلوات فقط." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {catalog.levels.map((l) => {
              const its = catalog.levelItems.filter((li) => li.level_id === l.id);
              return (
                <button key={l.id} onClick={() => setEditingLevel(l)} className="card-link p-4 text-start">
                  <p className="display text-xl">{l.name}</p>
                  {l.description && <p className="text-xs text-ink-soft">{l.description}</p>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {its.length === 0 ? (
                      <Chip tone="warn">بلا عبادات</Chip>
                    ) : (
                      its.map((li) => {
                        const item = catalog.items.find((i) => i.id === li.item_id);
                        return (
                          <Chip key={li.item_id} tone="neutral">
                            {item?.name}
                            {li.target != null ? ` ${li.target}` : ''}
                          </Chip>
                        );
                      })
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {addingItem && (
        <AddItem
          circleId={circleId}
          onClose={() => setAddingItem(false)}
          onSaved={() => {
            setAddingItem(false);
            onChanged();
          }}
        />
      )}
      {editingLevel && (
        <LevelSheet
          circleId={circleId}
          level={editingLevel === 'new' ? null : editingLevel}
          catalog={catalog}
          onClose={() => setEditingLevel(null)}
          onSaved={() => {
            setEditingLevel(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function AddItem({ circleId, onClose, onSaved }: { circleId: string; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<WirdKind>('check');
  const [unit, setUnit] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!name.trim()) return setErr('اكتب اسم العبادة.');
    const { error } = await supabase.from('worship_items').insert({
      circle_id: circleId,
      name: name.trim().slice(0, 80),
      kind,
      unit: kind === 'check' ? null : unit.trim().slice(0, 20) || null,
    });
    if (error) return setErr(error.code === '23505' ? 'هذه العبادة موجودة من قبل.' : dbMessage(error));
    onSaved();
  }

  return (
    <Sheet open onClose={onClose} title="عبادة جديدة">
      <label className="label" htmlFor="wi-name">الاسم</label>
      <input id="wi-name" className="field" maxLength={80} placeholder="الصلوات الخمس" value={name} onChange={(e) => setName(e.target.value)} />
      <p className="label mt-4">طريقة المتابعة</p>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(WIRD_KIND_LABEL) as WirdKind[]).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            aria-pressed={kind === k}
            className={`rounded-xl border px-2 py-2.5 text-sm ${kind === k ? 'border-brand-600 bg-brand-50 font-semibold' : 'border-line bg-white'}`}
          >
            {WIRD_KIND_LABEL[k]}
          </button>
        ))}
      </div>
      {kind !== 'check' && (
        <>
          <label className="label mt-4" htmlFor="wi-unit">الوحدة (اختياري)</label>
          <input id="wi-unit" className="field" maxLength={20} placeholder={kind === 'count' ? 'صفحة / مرة' : 'جزء / دقيقة'} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </>
      )}
      {err && <p className="mt-3 text-sm text-rose-700">{err}</p>}
      <button className="btn-primary mt-5 w-full" onClick={() => void submit()}>
        إضافة
      </button>
    </Sheet>
  );
}

function LevelSheet({
  circleId,
  level,
  catalog,
  onClose,
  onSaved,
}: {
  circleId: string;
  level: WirdLevel | null;
  catalog: WirdCatalog;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = level ? catalog.levelItems.filter((li) => li.level_id === level.id) : [];
  const [name, setName] = useState(level?.name ?? '');
  const [description, setDescription] = useState(level?.description ?? '');
  const [picked, setPicked] = useState<Map<string, string>>(
    new Map(existing.map((li) => [li.item_id, li.target == null ? '' : String(li.target)])),
  );
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Map(prev);
      if (next.has(id)) next.delete(id);
      else next.set(id, '');
      return next;
    });

  async function submit() {
    setErr(null);
    if (!name.trim()) return setErr('اكتب اسم المستوى.');
    for (const [id, t] of picked) {
      if (t && (!Number.isFinite(Number(t)) || Number(t) <= 0)) {
        return setErr(`هدف «${catalog.items.find((i) => i.id === id)?.name}» يجب أن يكون رقمًا أكبر من صفر.`);
      }
    }
    setBusy(true);
    let levelId = level?.id;
    if (level) {
      const { error } = await supabase
        .from('wird_levels')
        .update({ name: name.trim().slice(0, 80), description: description.trim().slice(0, 300) || null })
        .eq('id', level.id);
      if (error) return finish(dbMessage(error));
    } else {
      const { data, error } = await supabase
        .from('wird_levels')
        .insert({
          circle_id: circleId,
          name: name.trim().slice(0, 80),
          description: description.trim().slice(0, 300) || null,
          sort: catalog.levels.length + 1,
        })
        .select('id')
        .single();
      if (error) return finish(error.code === '23505' ? 'يوجد مستوى بهذا الاسم.' : dbMessage(error));
      levelId = data.id as string;
    }

    // مزامنة عبادات المستوى: حذف غير المختار، وإضافة/تحديث المختار بأهدافه
    const removed = existing.filter((li) => !picked.has(li.item_id)).map((li) => li.item_id);
    if (removed.length) {
      const { error } = await supabase.from('wird_level_items').delete().eq('level_id', levelId!).in('item_id', removed);
      if (error) return finish(dbMessage(error));
    }
    const rows = [...picked].map(([item_id, t], i) => ({ level_id: levelId!, item_id, target: t ? Number(t) : null, sort: i }));
    if (rows.length) {
      const { error } = await supabase.from('wird_level_items').upsert(rows, { onConflict: 'level_id,item_id' });
      if (error) return finish(dbMessage(error));
    }
    setBusy(false);
    onSaved();
  }

  function finish(message: string) {
    setBusy(false);
    setErr(message);
  }

  async function remove() {
    if (!level || !confirm(`حذف «${level.name}»؟`)) return;
    const { error } = await supabase.from('wird_levels').delete().eq('id', level.id);
    if (error) {
      return setErr(
        error.code === '23503' ? 'لا يُحذف مستوى عليه طلاب أو له سجل متابعة. انقل طلابه أولًا.' : dbMessage(error),
      );
    }
    onSaved();
  }

  return (
    <Sheet open onClose={onClose} title={level ? `تعديل ${level.name}` : 'مستوى جديد'}>
      <label className="label" htmlFor="lv-name">اسم المستوى</label>
      <input id="lv-name" className="field" maxLength={80} placeholder="المستوى الأول" value={name} onChange={(e) => setName(e.target.value)} />
      <label className="label mt-3" htmlFor="lv-desc">وصف (اختياري)</label>
      <input id="lv-desc" className="field" maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} />

      <p className="label mt-5">عبادات المستوى وأهدافها</p>
      <div className="space-y-1.5">
        {catalog.items
          .filter((i) => i.is_active || picked.has(i.id))
          .map((i) => (
            <div
              key={i.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 ${picked.has(i.id) ? 'border-brand-500 bg-brand-50' : 'border-line bg-white'}`}
            >
              <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-sm">
                <input type="checkbox" className="accent-brand-700" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                {i.name}
                <span className="text-xs text-ink-faint">{WIRD_KIND_LABEL[i.kind]}</span>
              </label>
              {picked.has(i.id) && i.kind !== 'check' && (
                <input
                  className="field w-24 px-2 py-1.5 text-center text-sm"
                  inputMode="decimal"
                  placeholder="الهدف"
                  aria-label={`هدف ${i.name}`}
                  value={picked.get(i.id)}
                  onChange={(e) => setPicked((prev) => new Map(prev).set(i.id, e.target.value))}
                />
              )}
            </div>
          ))}
      </div>
      <p className="mt-1.5 text-xs text-ink-faint">الهدف للعدد والكمية؛ إن تُرك فارغًا تكفي أي قيمة أكبر من صفر.</p>

      {err && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3.5 py-2.5 text-sm text-rose-800">{err}</p>}
      <button className="btn-primary mt-5 w-full" disabled={busy} onClick={() => void submit()}>
        {busy ? 'جارٍ الحفظ…' : 'حفظ'}
      </button>
      {level && (
        <button className="btn-ghost mt-2 w-full text-rose-700" onClick={() => void remove()}>
          <Trash2 size={15} />
          حذف المستوى
        </button>
      )}
    </Sheet>
  );
}
