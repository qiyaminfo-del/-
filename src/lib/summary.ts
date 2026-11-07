import type { TaskType } from './types';

const TYPES: Record<string, TaskType> = {
  عبادة: 'worship',
  نشاط: 'activity',
  مبادرة: 'initiative',
  بحث: 'research',
};

export interface ParsedTask {
  type: TaskType;
  title: string;
}

const norm = (s: string) => s.trim().toLowerCase();
export const taskKey = (t: ParsedTask) => `${t.type}|${norm(t.title)}`;

/**
 * يستخرج التكاليف من سطور الملخص بصيغة: - [عبادة] ورد يومي
 * يتجاهل السطور الفارغة، ويقصّ العنوان عند ٣٠٠ حرف (حدّ القاعدة)، ويُسقط المكرر داخل الملخص.
 */
export function parseTasks(md: string): ParsedTask[] {
  const seen = new Set<string>();
  const out: ParsedTask[] = [];
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(/^\s*-\s*\[(عبادة|نشاط|مبادرة|بحث)\]\s*(.+)$/);
    const title = m?.[2].trim().slice(0, 300);
    if (!m || !title) continue;
    const task = { type: TYPES[m[1]], title };
    const k = taskKey(task);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(task);
  }
  return out;
}
