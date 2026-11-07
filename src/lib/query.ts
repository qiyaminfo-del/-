/**
 * استعلامات آمنة مع المجالس الكبيرة.
 * - Supabase يقف عند ألف صف بصمت، فنجلب على صفحات.
 * - .in() بمئات المعرّفات يطيل الرابط حتى يرفضه الخادم، فنقسّم المعرّفات.
 */
import { supabase } from '@/lib/supabase';

const PAGE = 1000;
const CHUNK = 100;

// بلا أنواع مولَّدة للقاعدة، أنواع البنّاء تتعمق بلا نهاية؛ any هنا محصورة في هذا الملف.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

/** يجلب كل الصفوف صفحةً صفحة. make يبني استعلامًا جديدًا في كل مرة. */
export async function fetchAll<T>(make: () => Query, orderBy = 'id'): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make()
      .order(orderBy, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) {
      console.error('[مجالس] فشل الاستعلام', error);
      break;
    }
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** مثل .in(column, values) لكن بلا حدّ لطول القائمة ولا لعدد الصفوف. */
export async function selectIn<T>(
  table: string,
  columns: string,
  column: string,
  values: string[],
  refine: (q: Query) => Query = (q) => q,
  orderBy = 'id',
): Promise<T[]> {
  if (!values.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += CHUNK) chunks.push(values.slice(i, i + CHUNK));
  const parts = await Promise.all(
    chunks.map((c) => fetchAll<T>(() => refine(supabase.from(table).select(columns).in(column, c)), orderBy)),
  );
  return parts.flat();
}
