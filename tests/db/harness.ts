/**
 * أدوات مشتركة لاختبارات القاعدة: قاعدة مؤقتة نظيفة، وتنفيذ بصفة مستخدم داخل معاملة تُلغى.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { expect } from 'vitest';

export type Err = { code?: string; message: string };
export type Attempt = { ok: true; rows: Record<string, unknown>[]; rowCount: number } | { ok: false; error: Err };

export const ADMIN_URL = process.env.TEST_DATABASE_URL;

export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
export const stubSql = () => read('./stub.sql');
export const setupSql = () => (process.env.SETUP_SQL ? readFileSync(process.env.SETUP_SQL, 'utf8') : read('../../supabase/setup_all.sql'));

export class Harness {
  db!: Client;
  private admin!: Client;
  private name = '';

  /** قاعدة جديدة؛ sql اختياري بدل التهيئة الكاملة (لاختبار نقل البيانات بين الهجرات) */
  async open(prefix: string, sql: string | null = setupSql()) {
    this.name = `${prefix}_${process.pid}_${Date.now()}`;
    this.admin = new Client({ connectionString: ADMIN_URL });
    await this.admin.connect();
    await this.admin.query(`create database ${this.name}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${this.name}`;
    this.db = new Client({ connectionString: u.toString() });
    await this.db.connect();
    await this.db.query(stubSql());
    if (sql) await this.db.query(sql);
  }

  async close() {
    await this.db?.end();
    await this.admin?.query(`drop database if exists ${this.name} with (force)`);
    await this.admin?.end();
  }

  async run<T>(role: 'authenticated' | 'anon' | 'super', uid: string | null, fn: (c: Client) => Promise<T>): Promise<T> {
    await this.db.query('begin');
    try {
      if (role !== 'super') await this.db.query(`set local role ${role}`);
      await this.db.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
      return await fn(this.db);
    } finally {
      await this.db.query('rollback');
    }
  }

  as = <T>(uid: string | null, fn: (c: Client) => Promise<T>) => this.run('authenticated', uid, fn);
  sup = <T>(fn: (c: Client) => Promise<T>) => this.run('super', null, fn);

  /** يبدّل هوية المستخدم داخل نفس المعاملة (لتسلسل خطوات بأكثر من شخص) */
  async become(c: Client, uid: string | null) {
    await c.query('reset role');
    if (uid) {
      await c.query('set local role authenticated');
    }
    await c.query("select set_config('request.jwt.claim.sub', $1, true)", [uid ?? '']);
  }

  count = async (uid: string, sql: string, params: unknown[] = []) =>
    Number((await this.as(uid, (c) => c.query(sql, params))).rows[0].n);

  tryAs = (uid: string, sql: string, params: unknown[] = []) => this.as(uid, (c) => attempt(c, sql, params));

  mustFail = async (uid: string, sql: string, params: unknown[] = [], pattern?: RegExp) => {
    const r = await this.tryAs(uid, sql, params);
    expect(r.ok, `كان يجب أن يُرفض: ${sql}`).toBe(false);
    if (!r.ok && pattern) expect(r.error.message).toMatch(pattern);
  };

  mustAffect = async (uid: string, sql: string, params: unknown[] = [], n = 1) => {
    const r = await this.tryAs(uid, sql, params);
    expect(r.ok, `كان يجب أن ينجح: ${sql}${r.ok ? '' : ' → ' + r.error.message}`).toBe(true);
    if (r.ok) expect(r.rowCount).toBe(n);
  };

  mustAffectNothing = async (uid: string, sql: string, params: unknown[] = []) => {
    const r = await this.tryAs(uid, sql, params);
    expect(r.ok && r.rowCount, `كان يجب ألا يطال صفًا: ${sql}${r.ok ? '' : ' → ' + r.error.message}`).toBe(0);
  };
}

/** ينفّذ داخل savepoint فلا يُفسد خطأ واحد بقية المعاملة. */
export async function attempt(c: Client, sql: string, params: unknown[] = []): Promise<Attempt> {
  await c.query('savepoint sp');
  try {
    const r = await c.query(sql, params);
    await c.query('release savepoint sp');
    return { ok: true, rows: r.rows, rowCount: r.rowCount ?? 0 };
  } catch (e) {
    await c.query('rollback to savepoint sp');
    return { ok: false, error: e as Err };
  }
}

export const ok = (r: Attempt): Record<string, unknown>[] => {
  if (!r.ok) throw new Error(`رُفضت المحاولة: ${r.error.message}`);
  return r.rows;
};
