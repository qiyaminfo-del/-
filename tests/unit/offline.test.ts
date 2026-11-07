import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Result = { error: null | { code?: string; message: string } };

const h = vi.hoisted(() => ({
  uid: 'user-1' as string | null,
  /** يحدد نتيجة كل كتابة؛ يُستدعى لكل محاولة إرسال */
  respond: ((): Result => ({ error: null })) as (op: { table: string; payload: Record<string, unknown> }) => Result,
  sent: [] as { table: string; payload: Record<string, unknown>; kind: string }[],
}));

vi.mock('@/lib/supabase', () => {
  const send = (table: string, kind: string) => (payload: Record<string, unknown>) => {
    h.sent.push({ table, payload, kind });
    return Promise.resolve(h.respond({ table, payload }));
  };
  return {
    isConfigured: true,
    supabase: {
      auth: { getSession: () => Promise.resolve({ data: { session: h.uid ? { user: { id: h.uid } } : null } }) },
      from: (table: string) => ({ upsert: send(table, 'upsert'), insert: send(table, 'insert') }),
    },
  };
});

const setOnline = (v: boolean) => Object.defineProperty(navigator, 'onLine', { value: v, configurable: true });

type Offline = typeof import('@/lib/offline');
let q: Offline;

const att = (student: string, state = 'present') => ({ session_id: 's1', student_id: student, state });

beforeEach(async () => {
  globalThis.indexedDB = new IDBFactory(); // قاعدة نظيفة لكل اختبار
  vi.resetModules();
  h.uid = 'user-1';
  h.sent = [];
  h.respond = () => ({ error: null });
  setOnline(true);
  q = await import('@/lib/offline');
});

describe('writeOrQueue', () => {
  it('متصل وناجح → synced ولا شيء في الطابور', async () => {
    expect(await q.writeOrQueue('attendance', att('a'), 'session_id,student_id')).toBe('synced');
    expect(await q.pendingCount()).toBe(0);
    expect(h.sent).toHaveLength(1);
  });

  it('بلا إنترنت → queued ولا محاولة إرسال', async () => {
    setOnline(false);
    expect(await q.writeOrQueue('attendance', att('a'), 'session_id,student_id')).toBe('queued');
    expect(await q.pendingCount()).toBe(1);
    expect(h.sent).toHaveLength(0);
  });

  it('فشل شبكة (بلا رمز SQL) → queued', async () => {
    h.respond = () => ({ error: { message: 'Failed to fetch' } });
    expect(await q.writeOrQueue('attendance', att('a'), 'session_id,student_id')).toBe('queued');
    expect(await q.pendingCount()).toBe(1);
  });

  it('رفض من القاعدة (صلاحية) → rejected ولا يدخل الطابور أبدًا', async () => {
    h.respond = () => ({ error: { code: '42501', message: 'permission denied' } });
    expect(await q.writeOrQueue('attendance', att('a'), 'session_id,student_id')).toBe('rejected');
    expect(await q.pendingCount()).toBe(0);
  });

  it('رمز دخول منتهٍ (PGRST301) يُعاد لاحقًا لا يُرفض', async () => {
    h.respond = () => ({ error: { code: 'PGRST301', message: 'JWT expired' } });
    expect(await q.writeOrQueue('attendance', att('a'), 'session_id,student_id')).toBe('queued');
  });

  it('آخر تسجيل لنفس الصف يحل محل القديم في الطابور', async () => {
    setOnline(false);
    await q.writeOrQueue('attendance', att('a', 'present'), 'session_id,student_id');
    await q.writeOrQueue('attendance', att('a', 'late'), 'session_id,student_id');
    await q.writeOrQueue('attendance', att('a', 'absent'), 'session_id,student_id');
    await q.writeOrQueue('attendance', att('b', 'present'), 'session_id,student_id');
    expect(await q.pendingCount()).toBe(2);

    setOnline(true);
    expect(await q.flush()).toBe(2);
    const forA = h.sent.filter((s) => s.payload.student_id === 'a');
    expect(forA).toHaveLength(1);
    expect(forA[0].payload.state).toBe('absent'); // لا نسخة قديمة تكتب فوق أحدث
  });

  it('كتابة ناجحة أحدث تلغي النسخة الأقدم المنتظرة', async () => {
    setOnline(false);
    await q.writeOrQueue('attendance', att('a', 'present'), 'session_id,student_id');
    setOnline(true);
    expect(await q.writeOrQueue('attendance', att('a', 'late'), 'session_id,student_id')).toBe('synced');
    expect(await q.pendingCount()).toBe(0);
    expect(await q.flush()).toBe(0);
    expect(h.sent.map((s) => s.payload.state)).toEqual(['late']);
  });
});

describe('flush', () => {
  const queueTwo = async () => {
    setOnline(false);
    await q.writeOrQueue('attendance', att('a'), 'session_id,student_id');
    await q.writeOrQueue('attendance', att('b'), 'session_id,student_id');
    setOnline(true);
  };

  it('ينجح ويفرّغ الطابور', async () => {
    await queueTwo();
    expect(await q.flush()).toBe(2);
    expect(await q.pendingCount()).toBe(0);
    expect(await q.failedCount()).toBe(0);
  });

  it('سقوط الشبكة في المنتصف: يتوقف ويُبقي الباقي بالترتيب', async () => {
    await queueTwo();
    let n = 0;
    h.respond = () => (++n === 1 ? { error: null } : { error: { message: 'Failed to fetch' } });
    expect(await q.flush()).toBe(1);
    expect(await q.pendingCount()).toBe(1);
    expect(h.sent).toHaveLength(2); // لم يواصل بعد أول فشل
  });

  it('رفض نهائي يُنقل إلى «تعذّر رفعها» ولا يُعاد، والباقي يكمل', async () => {
    await queueTwo();
    h.respond = ({ payload }) =>
      payload.student_id === 'a' ? { error: { code: '42501', message: 'denied' } } : { error: null };
    expect(await q.flush()).toBe(1);
    expect(await q.pendingCount()).toBe(0);
    expect(await q.failedCount()).toBe(1);
    const [failed] = await q.failedOps();
    expect(failed.error).toBe('denied');
    expect(failed.payload.student_id).toBe('a');

    // لا إعادة محاولة لما رُفض
    h.sent = [];
    await q.flush();
    expect(h.sent).toHaveLength(0);
  });

  it('عمليتان متزامنتان لـ flush تشتركان في تنفيذ واحد (لا إرسال مزدوج)', async () => {
    await queueTwo();
    const [x, y] = await Promise.all([q.flush(), q.flush()]);
    expect(x).toBe(2);
    expect(y).toBe(2);
    expect(h.sent).toHaveLength(2);
  });

  it('لا يرفع بلا جلسة دخول', async () => {
    await queueTwo();
    h.uid = null;
    expect(await q.flush()).toBe(0);
    expect(await q.pendingCount()).toBe(2);
    expect(h.sent).toHaveLength(0);
  });

  it('لا يرفع بلا إنترنت', async () => {
    await queueTwo();
    setOnline(false);
    expect(await q.flush()).toBe(0);
    expect(h.sent).toHaveLength(0);
  });

  it('عملية مستخدم آخر على نفس الجهاز لا تُرفع بحسابي', async () => {
    await queueTwo(); // سُجّلت باسم user-1
    h.uid = 'user-2';
    expect(await q.flush()).toBe(0);
    expect(h.sent).toHaveLength(0);
    expect(await q.pendingCount()).toBe(0);
    expect(await q.failedCount()).toBe(2);
  });
});

describe('تنظيف', () => {
  it('clearOutbox وclearFailed يفرّغان كل شيء (عند الخروج)', async () => {
    setOnline(false);
    await q.writeOrQueue('attendance', att('a'), 'session_id,student_id');
    await q.clearOutbox();
    expect(await q.pendingCount()).toBe(0);

    setOnline(true);
    h.respond = () => ({ error: { code: '42501', message: 'denied' } });
    setOnline(false);
    await q.writeOrQueue('attendance', att('z'), 'session_id,student_id');
    setOnline(true);
    await q.flush();
    expect(await q.failedCount()).toBe(1);
    await q.clearFailed();
    expect(await q.failedCount()).toBe(0);
  });
});
