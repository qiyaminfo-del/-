import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useApp } from '@/store/session';
import type { Session, WaTemplate } from '@/lib/types';

/** الجلسة القادمة أو الجارية في المجلس النشط. */
export function useCurrentSession() {
  const circleId = useApp((s) => s.activeCircleId);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!circleId) {
      setSession(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const since = new Date(Date.now() - 12 * 3600_000).toISOString();
    const { data } = await supabase
      .from('sessions')
      .select('*')
      .eq('circle_id', circleId)
      .gte('held_at', since)
      .order('held_at', { ascending: true })
      .limit(1);

    if (data && data.length) {
      setSession(data[0] as Session);
    } else {
      const { data: last } = await supabase
        .from('sessions')
        .select('*')
        .eq('circle_id', circleId)
        .order('held_at', { ascending: false })
        .limit(1);
      setSession((last?.[0] as Session) ?? null);
    }
    setLoading(false);
  }, [circleId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { session, loading, reload: load };
}

export function useTemplates() {
  const circleId = useApp((s) => s.activeCircleId);
  const [templates, setTemplates] = useState<WaTemplate[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('wa_templates')
        .select('*')
        .or(`circle_id.is.null,circle_id.eq.${circleId ?? '00000000-0000-0000-0000-000000000000'}`)
        .order('label');
      setTemplates((data ?? []) as WaTemplate[]);
    })();
  }, [circleId]);

  return templates;
}
