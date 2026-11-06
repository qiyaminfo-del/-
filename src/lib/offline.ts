/**
 * طابور العمل بلا إنترنت.
 * قاعات المجالس كثيرًا ما تكون ضعيفة الشبكة، فكشف الحضور يُسجَّل محليًا
 * في IndexedDB ثم يُزامَن تلقائيًا عند عودة الاتصال.
 *
 * - خطأ الشبكة يُبقي العملية في الطابور لتُعاد لاحقًا.
 * - رفض القاعدة (صلاحية، قيد) لا يُعاد أبدًا: تنتقل العملية إلى سجل «تعذّر رفعها».
 * - لكل صف مفتاح واحد في الطابور: آخر تسجيل يلغي ما قبله، فلا تكتب نسخة قديمة فوق أحدث.
 * - كل عملية تحمل صاحبها، فلا تُرفع عملية مستخدم بحساب مستخدم آخر.
 */
import { openDB, type IDBPDatabase } from 'idb';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './supabase';

export interface QueuedOp {
  id?: number;
  table: string;
  payload: Record<string, unknown>;
  conflictKey?: string; // أعمدة onConflict للـ upsert
  owner?: string | null;
  dedupe?: string;
  queuedAt: number;
}

export interface FailedOp extends QueuedOp {
  error: string;
  failedAt: number;
}

const DB_NAME = 'majales';
const STORE = 'outbox';
const FAILED = 'failed';

let dbPromise: Promise<IDBPDatabase> | null = null;
let flushing: Promise<number> | null = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 2, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) {
          d.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
        if (!d.objectStoreNames.contains(FAILED)) {
          d.createObjectStore(FAILED, { keyPath: 'id', autoIncrement: true });
        }
      },
    });
  }
  return dbPromise;
}

async function currentUser(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/** مفتاح الصف: الجدول وقيم أعمدة التعارض. */
function dedupeKey(table: string, payload: Record<string, unknown>, conflictKey?: string): string | undefined {
  if (!conflictKey) return undefined;
  return `${table}:${conflictKey
    .split(',')
    .map((c) => String(payload[c.trim()]))
    .join('|')}`;
}

/** خطأ شبكة أو جلسة منتهية: يُعاد. غير ذلك رفض نهائي من القاعدة. */
function isRetryable(error: PostgrestError): boolean {
  if (!navigator.onLine) return true;
  if (!error.code) return true; // فشل الاتصال نفسه لا يحمل رمز SQLSTATE
  return error.code === 'PGRST301' || error.code === 'PGRST303'; // رمز دخول منتهٍ
}

async function send(op: Pick<QueuedOp, 'table' | 'payload' | 'conflictKey'>) {
  const query = supabase.from(op.table);
  return op.conflictKey
    ? query.upsert(op.payload, { onConflict: op.conflictKey })
    : query.insert(op.payload);
}

async function dropQueued(dedupe: string | undefined) {
  if (!dedupe) return;
  const d = await db();
  const all = (await d.getAll(STORE)) as QueuedOp[];
  for (const op of all) if (op.dedupe === dedupe && op.id != null) await d.delete(STORE, op.id);
}

export async function enqueue(op: Omit<QueuedOp, 'id' | 'queuedAt' | 'owner' | 'dedupe'>): Promise<void> {
  const dedupe = dedupeKey(op.table, op.payload, op.conflictKey);
  await dropQueued(dedupe);
  const d = await db();
  await d.add(STORE, { ...op, dedupe, owner: await currentUser(), queuedAt: Date.now() });
}

export async function pendingCount(): Promise<number> {
  const d = await db();
  return d.count(STORE);
}

export async function failedCount(): Promise<number> {
  const d = await db();
  return d.count(FAILED);
}

export async function failedOps(): Promise<FailedOp[]> {
  const d = await db();
  return (await d.getAll(FAILED)) as FailedOp[];
}

export async function clearFailed(): Promise<void> {
  const d = await db();
  await d.clear(FAILED);
}

/** يحذف كل ما في الطابور. يُستدعى عند تسجيل الخروج. */
export async function clearOutbox(): Promise<void> {
  const d = await db();
  await d.clear(STORE);
}

async function moveToFailed(op: QueuedOp, error: string) {
  const d = await db();
  const { id, ...rest } = op;
  await d.add(FAILED, { ...rest, error, failedAt: Date.now() });
  if (id != null) await d.delete(STORE, id);
}

async function doFlush(): Promise<number> {
  if (!navigator.onLine) return 0;
  const uid = await currentUser();
  if (!uid) return 0;

  const d = await db();
  const all = (await d.getAll(STORE)) as QueuedOp[];
  let ok = 0;

  for (const op of all) {
    // عملية مستخدم آخر على هذا الجهاز: لا تُرفع بحسابي
    if (op.owner && op.owner !== uid) {
      await moveToFailed(op, 'سُجّلت بحساب آخر على هذا الجهاز');
      continue;
    }

    const { error } = await send(op);
    if (!error) {
      if (op.id != null) await d.delete(STORE, op.id);
      ok += 1;
    } else if (isRetryable(error)) {
      break; // الشبكة سقطت: نتوقف ونعيد المحاولة لاحقًا بالترتيب نفسه
    } else {
      await moveToFailed(op, error.message);
    }
  }
  return ok;
}

/** رفع كل ما في الطابور، مرة واحدة في كل وقت. يُرجع عدد ما نجح. */
export function flush(): Promise<number> {
  if (!flushing) {
    flushing = doFlush().finally(() => {
      flushing = null;
    });
  }
  return flushing;
}

/**
 * اكتب الآن إن أمكن، وإلا ضعه في الطابور.
 * يُرجع 'synced' أو 'queued' أو 'rejected' إذا رفضته القاعدة.
 */
export async function writeOrQueue(
  table: string,
  payload: Record<string, unknown>,
  conflictKey?: string,
): Promise<'synced' | 'queued' | 'rejected'> {
  if (navigator.onLine) {
    const { error } = await send({ table, payload, conflictKey });
    if (!error) {
      // كتابة أحدث وصلت: أي نسخة أقدم للصف نفسه في الطابور تُلغى
      await dropQueued(dedupeKey(table, payload, conflictKey));
      return 'synced';
    }
    if (!isRetryable(error)) {
      console.error('[مجالس] رفضت القاعدة الكتابة', error);
      return 'rejected';
    }
  }
  await enqueue({ table, payload, conflictKey });
  return 'queued';
}

/** تشغيل المزامنة تلقائيًا عند عودة الاتصال. */
export function startAutoSync(onFlushed?: (n: number) => void) {
  const run = () => {
    void flush().then((n) => onFlushed?.(n));
  };
  window.addEventListener('online', run);
  const timer = window.setInterval(run, 30_000);
  run();
  return () => {
    window.removeEventListener('online', run);
    window.clearInterval(timer);
  };
}
