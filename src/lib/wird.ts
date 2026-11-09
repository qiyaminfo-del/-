import type { WirdKind, WirdLevelItem, WirdLog, WorshipItem } from './types';

/** هل يُعدّ هذا السجل إنجازًا؟ (نفس قاعدة wird_report في القاعدة) */
export function isComplete(kind: WirdKind, log: Pick<WirdLog, 'done' | 'value'> | undefined, target: number | null): boolean {
  if (!log) return false;
  if (kind === 'check') return log.done === true;
  if (log.value == null) return false;
  return target == null ? Number(log.value) > 0 : Number(log.value) >= Number(target);
}

export interface DayItem {
  item: WorshipItem;
  target: number | null;
  log: WirdLog | undefined;
  complete: boolean;
}

/** أوراد يوم واحد مرتبة كما في المستوى، مع حالة كل عبادة ونسبة الإنجاز */
export function buildDay(
  levelItems: WirdLevelItem[],
  items: WorshipItem[],
  logs: WirdLog[],
): { rows: DayItem[]; done: number; total: number; percent: number } {
  const byId = new Map(items.map((i) => [i.id, i]));
  const logByItem = new Map(logs.map((l) => [l.item_id, l]));
  const rows = [...levelItems]
    .sort((a, b) => a.sort - b.sort)
    .flatMap((li) => {
      const item = byId.get(li.item_id);
      if (!item) return [];
      const log = logByItem.get(li.item_id);
      return [{ item, target: li.target, log, complete: isComplete(item.kind, log, li.target) }];
    });
  const done = rows.filter((r) => r.complete).length;
  return { rows, done, total: rows.length, percent: rows.length ? Math.round((100 * done) / rows.length) : 0 };
}

/** تاريخ محلي بصيغة YYYY-MM-DD (لا UTC، حتى لا يصبح «اليوم» أمس بعد منتصف الليل) */
export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return localDay(new Date(y, m - 1, d + delta));
}
