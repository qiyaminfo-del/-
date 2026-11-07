import { describe, expect, it } from 'vitest';
import { authMessage, dbMessage } from '@/lib/errors';
import { parseTasks, taskKey } from '@/lib/summary';

describe('authMessage', () => {
  it.each([
    ['Invalid login credentials', 'البريد أو كلمة المرور غير صحيحة.'],
    ['Email not confirmed', 'لم يُفعَّل'],
    ['User already registered', 'مسجَّل من قبل'],
    ['Password should be at least 6 characters', 'ضعيفة'],
    ['email rate limit exceeded', 'محاولات كثيرة'],
    ['Failed to fetch', 'تعذّر الاتصال'],
  ])('%s', (msg, fragment) => {
    expect(authMessage({ message: msg })).toContain(fragment);
  });

  it('أي نص مجهول لا يتسرّب للمستخدم', () => {
    expect(authMessage({ message: 'internal: relation auth.users xyz' })).toBe('تعذّر إتمام العملية. أعد المحاولة.');
    expect(authMessage(null)).toBe('تعذّر إتمام العملية. أعد المحاولة.');
  });
});

describe('dbMessage', () => {
  it('رسائل القاعدة العربية (من التريجرات) تُعرض كما هي', () => {
    expect(dbMessage({ code: 'P0001', message: 'لا يجوز تعديل إيصال.' })).toBe('لا يجوز تعديل إيصال.');
  });
  it.each([
    ['42501', 'صلاحية'],
    ['23505', 'مسجَّل من قبل'],
    ['23503', 'مرتبط'],
    ['23514', 'غير مقبولة'],
    ['22P02', 'صيغة'],
  ])('رمز %s', (code, fragment) => {
    expect(dbMessage({ code, message: 'raw english' })).toContain(fragment);
  });
  it('رسالة RLS الإنجليزية تتحول لصلاحية، والمجهول لا يتسرّب', () => {
    expect(dbMessage({ message: 'new row violates row-level security policy for table "x"' })).toContain('صلاحية');
    expect(dbMessage({ message: 'select * from secret_table failed' })).toBe('تعذّر إتمام العملية. أعد المحاولة.');
    expect(dbMessage(null)).toBe('تعذّر إتمام العملية.');
  });
});

describe('parseTasks', () => {
  it('يستخرج الأنواع الأربعة', () => {
    const tasks = parseTasks(['- [عبادة] ورد يومي', '- [نشاط] زيارة', '- [مبادرة] جمع تبرعات', '- [بحث] الإخلاص'].join('\n'));
    expect(tasks.map((t) => t.type)).toEqual(['worship', 'activity', 'initiative', 'research']);
    expect(tasks[0].title).toBe('ورد يومي');
  });

  it('يتجاهل ما ليس تكليفًا أو بلا عنوان', () => {
    expect(parseTasks('## المحاور\n- فائدة عادية\n- [عبادة]\n- [نوع] غريب\n\n')).toEqual([]);
  });

  it('يتحمل مسافات وCRLF', () => {
    expect(parseTasks('  -   [عبادة]   ورد  \r\n- [بحث] س\r\n')).toHaveLength(2);
  });

  it('يُسقط المكرر داخل الملخص (مع اختلاف المسافات والحالة)', () => {
    expect(parseTasks('- [عبادة] ورد\n- [عبادة]  ورد  \n- [نشاط] ورد')).toHaveLength(2);
  });

  it('يقصّ العنوان الطويل عند حدّ القاعدة (٣٠٠)', () => {
    const [t] = parseTasks(`- [عبادة] ${'ا'.repeat(1000)}`);
    expect(t.title).toHaveLength(300);
  });

  it('taskKey يوحّد الحالة والمسافات', () => {
    expect(taskKey({ type: 'worship', title: ' Wird ' })).toBe(taskKey({ type: 'worship', title: 'wird' }));
  });
});
