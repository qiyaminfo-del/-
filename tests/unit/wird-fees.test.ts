import { describe, expect, it } from 'vitest';
import { buildDay, isComplete, localDay, shiftDay } from '@/lib/wird';
import { dueStatus, exemptionError, paymentError } from '@/lib/fees';
import { levelOnDay } from '@/pages/wird/data';
import type { StudentLevel, WirdLevelItem, WirdLog, WorshipItem } from '@/lib/types';

const item = (id: string, kind: WorshipItem['kind']): WorshipItem => ({
  id, circle_id: 'c', name: id, kind, unit: null, is_active: true, sort: 0,
});
const log = (item_id: string, p: Partial<WirdLog>): WirdLog => ({
  id: item_id, student_id: 's', item_id, day: '2026-11-09', level_id: 'l', done: null, value: null, ...p,
});

describe('إنجاز العبادة (نفس قاعدة القاعدة)', () => {
  it('تم/لم يتم', () => {
    expect(isComplete('check', log('a', { done: true }), null)).toBe(true);
    expect(isComplete('check', log('a', { done: false }), null)).toBe(false);
    expect(isComplete('check', undefined, null)).toBe(false);
  });

  it('العدد والكمية: الهدف إن وُجد، وإلا أي قيمة أكبر من صفر', () => {
    expect(isComplete('count', log('q', { value: 5 }), 5)).toBe(true);
    expect(isComplete('count', log('q', { value: 4 }), 5)).toBe(false);
    expect(isComplete('amount', log('q', { value: 0.5 }), null)).toBe(true);
    expect(isComplete('amount', log('q', { value: 0 }), null)).toBe(false);
    expect(isComplete('count', log('q', { value: null }), null)).toBe(false);
  });

  it('أوراد اليوم بترتيب المستوى ونسبة الإنجاز', () => {
    const items = [item('prayer', 'check'), item('quran', 'count'), item('dhikr', 'check')];
    const li: WirdLevelItem[] = [
      { level_id: 'l', item_id: 'quran', target: 5, sort: 2 },
      { level_id: 'l', item_id: 'prayer', target: null, sort: 1 },
      { level_id: 'l', item_id: 'gone', target: null, sort: 3 }, // عبادة محذوفة لا تظهر
    ];
    const day = buildDay(li, items, [log('prayer', { done: true }), log('quran', { value: 3 })]);
    expect(day.rows.map((r) => r.item.id)).toEqual(['prayer', 'quran']);
    expect(day).toMatchObject({ done: 1, total: 2, percent: 50 });
    expect(buildDay([], items, []).percent).toBe(0);
  });
});

describe('مستوى الطالب في يوم بعينه', () => {
  const at = (d: string, h = 10) => new Date(`${d}T${String(h).padStart(2, '0')}:00:00`).toISOString();
  const hist: StudentLevel[] = [
    { id: '1', circle_id: 'c', student_id: 's', level_id: 'L1', started_at: at('2026-11-01'), ended_at: at('2026-11-05') },
    { id: '2', circle_id: 'c', student_id: 's', level_id: 'L2', started_at: at('2026-11-05'), ended_at: null },
  ];

  it('قبل أي مستوى: لا شيء', () => expect(levelOnDay(hist, '2026-10-31')).toBeNull());
  it('أثناء المستوى الأول', () => expect(levelOnDay(hist, '2026-11-03')).toBe('L1'));
  it('يوم النقل يُحسب على المستوى الجديد', () => expect(levelOnDay(hist, '2026-11-05')).toBe('L2'));
  it('بعد النقل', () => expect(levelOnDay(hist, '2026-11-09')).toBe('L2'));
  it('إيقاف المتابعة: لا مستوى بعدها', () => {
    const stopped = [{ ...hist[0], ended_at: at('2026-11-03') }];
    expect(levelOnDay(stopped, '2026-11-04')).toBeNull();
  });
});

describe('التواريخ المحلية', () => {
  it('shiftDay يعبر حدود الشهر والسنة', () => {
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('localDay بصيغة YYYY-MM-DD', () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

describe('حالة الرسوم وتحقق المبالغ', () => {
  it('الحالة', () => {
    expect(dueStatus(300, 0, 0)).toBe('unpaid');
    expect(dueStatus(300, 0, 100)).toBe('partial');
    expect(dueStatus(300, 100, 200)).toBe('paid');
    expect(dueStatus(300, 300, 0)).toBe('exempt');
  });

  it.each([
    ['', 'اكتب'],
    ['abc', 'اكتب'],
    ['0', 'أكبر من صفر'],
    ['-5', 'أكبر من صفر'],
    ['10.555', 'قرشين'],
    ['60', 'أكبر من المتبقي'],
  ])('الدفعة «%s» مرفوضة', (raw, msg) => {
    expect(paymentError(raw, 50)).toContain(msg);
  });

  it('الدفعة الصحيحة حتى المتبقي بالضبط', () => {
    expect(paymentError('50', 50)).toBeNull();
    expect(paymentError('12.5', 50)).toBeNull();
  });

  it('الإعفاء: حدود وسبب، ولا يجعل المدفوع أكبر من الصافي', () => {
    expect(exemptionError('400', 'س', 300, 0)).toContain('أكبر من المبلغ');
    expect(exemptionError('100', '', 300, 0)).toContain('سبب');
    expect(exemptionError('250', 'ظرف', 300, 100)).toContain('المدفوع');
    expect(exemptionError('200', 'ظرف', 300, 100)).toBeNull();
    expect(exemptionError('0', '', 300, 100)).toBeNull(); // إلغاء الإعفاء
  });
});
