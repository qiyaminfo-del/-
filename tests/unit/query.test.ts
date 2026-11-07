import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  fromImpl: null as null | ((table: string) => unknown),
}));

vi.mock('@/lib/supabase', () => ({
  isConfigured: true,
  supabase: { from: (t: string) => h.fromImpl!(t) },
}));

import { fetchAll, selectIn } from '@/lib/query';

/** بنّاء وهمي يحاكي PostgREST: order().range() يقصّ على الصفحات. */
const pager = (rows: unknown[], calls?: [number, number][]) => ({
  order: () => ({
    range: (a: number, b: number) => {
      calls?.push([a, b]);
      return Promise.resolve({ data: rows.slice(a, b + 1), error: null });
    },
  }),
});

describe('fetchAll', () => {
  it('يجلب أكثر من ألف صف على صفحات (لا يقف عند حدّ Supabase)', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
    const calls: [number, number][] = [];
    const out = await fetchAll(() => pager(rows, calls));
    expect(out).toHaveLength(2500);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('عدد صفوف من مضاعفات الصفحة لا يدخل في حلقة لا نهائية', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => ({ id: i }));
    const out = await fetchAll(() => pager(rows));
    expect(out).toHaveLength(2000);
  });

  it('نتيجة فارغة', async () => {
    expect(await fetchAll(() => pager([]))).toEqual([]);
  });

  it('عند الخطأ يتوقف ويرجع ما جُمع بدل الانهيار', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    let n = 0;
    const out = await fetchAll(() => ({
      order: () => ({
        range: () => {
          n += 1;
          return Promise.resolve(
            n === 1
              ? { data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null }
              : { data: null, error: { message: 'boom' } },
          );
        },
      }),
    }));
    expect(out).toHaveLength(1000);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe('selectIn', () => {
  beforeEach(() => {
    h.fromImpl = null;
  });

  it('قائمة فارغة: لا يتصل بالقاعدة أصلًا', async () => {
    h.fromImpl = () => {
      throw new Error('لا يجب أن يُستدعى');
    };
    expect(await selectIn('profiles', '*', 'id', [])).toEqual([]);
  });

  it('يقسّم المعرّفات إلى دفعات ≤ ١٠٠ (يمنع تجاوز طول الرابط)', async () => {
    const sizes: number[] = [];
    h.fromImpl = () => ({
      select: () => ({
        in: (_col: string, chunk: string[]) => {
          sizes.push(chunk.length);
          return pager(chunk.map((id) => ({ id })));
        },
      }),
    });
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const out = await selectIn<{ id: string }>('profiles', 'id', 'id', ids);
    expect(sizes.sort((a, b) => b - a)).toEqual([100, 100, 50]);
    expect(out).toHaveLength(250);
    expect(new Set(out.map((r) => r.id)).size).toBe(250);
  });

  it('يطبّق refine على كل دفعة', async () => {
    const refined = vi.fn();
    h.fromImpl = () => ({
      select: () => ({
        in: (_c: string, chunk: string[]) => ({
          ...pager(chunk.map((id) => ({ id }))),
          marker: true,
        }),
      }),
    });
    await selectIn('assignments', 'id', 'role_id', ['a', 'b'], (q) => {
      refined(q);
      return q;
    });
    expect(refined).toHaveBeenCalledTimes(1);
    expect(refined.mock.calls[0][0]).toHaveProperty('marker', true);
  });
});
