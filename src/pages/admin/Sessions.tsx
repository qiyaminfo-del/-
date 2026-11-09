import { useCallback, useEffect, useState } from 'react';
import { CalendarPlus } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { dbMessage } from '@/lib/errors';
import { Card, Chip, Empty, Loading, Sheet } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import type { Session } from '@/lib/types';

export default function Sessions({ circleId }: { circleId: string }) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('circle_id', circleId)
      .order('held_at', { ascending: false })
      .limit(20);
    setSessions((data ?? []) as Session[]);
  }, [circleId]);

  useEffect(() => {
    setSessions(null);
    void load();
  }, [load]);

  if (sessions === null) return <Loading />;

  return (
    <>
      <button className="btn-primary mb-4" onClick={() => setCreating(true)}>
        <CalendarPlus size={17} />
        جلسة جديدة
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
      {creating && (
        <NewSession
          circleId={circleId}
          onClose={() => {
            setCreating(false);
            void load();
          }}
        />
      )}
    </>
  );
}

function NewSession({ circleId, onClose }: { circleId: string; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const [when, setWhen] = useState('');
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    if (!when) return setErr('حدد موعد المجلس.');
    const { error } = await supabase.from('sessions').insert({
      circle_id: circleId,
      title: title.trim() || null,
      held_at: new Date(when).toISOString(),
      status: 'scheduled',
    });
    if (error) setErr(dbMessage(error));
    else onClose();
  }

  return (
    <Sheet open onClose={onClose} title="جلسة جديدة">
      <label className="label" htmlFor="ns-title">عنوان المجلس (اختياري)</label>
      <input id="ns-title" className="field" maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
      <label className="label mt-4" htmlFor="ns-when">الموعد</label>
      <input id="ns-when" className="field" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
      {err && <p className="mt-3 text-sm text-rose-700">{err}</p>}
      <button className="btn-primary mt-4 w-full" onClick={() => void submit()}>
        إنشاء
      </button>
    </Sheet>
  );
}
