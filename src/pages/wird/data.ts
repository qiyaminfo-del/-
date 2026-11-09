import { supabase } from '@/lib/supabase';
import type { StudentLevel, WirdLevel, WirdLevelItem, WorshipItem } from '@/lib/types';

export interface WirdCatalog {
  items: WorshipItem[];
  levels: WirdLevel[];
  levelItems: WirdLevelItem[];
}

export async function loadCatalog(circleId: string): Promise<WirdCatalog> {
  const [{ data: items }, { data: levels }] = await Promise.all([
    supabase.from('worship_items').select('*').eq('circle_id', circleId).order('sort').order('name'),
    supabase.from('wird_levels').select('*').eq('circle_id', circleId).order('sort').order('name'),
  ]);
  const levelIds = (levels ?? []).map((l) => l.id as string);
  const { data: levelItems } = levelIds.length
    ? await supabase.from('wird_level_items').select('*').in('level_id', levelIds)
    : { data: [] };
  return {
    items: (items ?? []) as WorshipItem[],
    levels: (levels ?? []) as WirdLevel[],
    levelItems: ((levelItems ?? []) as WirdLevelItem[]).map((li) => ({
      ...li,
      target: li.target == null ? null : Number(li.target),
    })),
  };
}

/** مستوى الطالب في يوم (نفس قاعدة level_on_day في القاعدة): آخر نقل حتى نهاية ذلك اليوم */
export function levelOnDay(history: StudentLevel[], day: string): string | null {
  const match = history
    .filter((h) => localDate(h.started_at) <= day && (h.ended_at == null || localDate(h.ended_at) > day))
    .sort((a, b) => b.started_at.localeCompare(a.started_at))[0];
  return match?.level_id ?? null;
}

const localDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
