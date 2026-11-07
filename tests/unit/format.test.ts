import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { daysSince, formatDate, formatMoney, formatNumber, percent, relativeDay } from '@/lib/format';

describe('percent', () => {
  it('يقرّب إلى أقرب عدد صحيح', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(2, 3)).toBe(67);
    expect(percent(5, 5)).toBe(100);
  });
  it('القسمة على صفر ترجع صفرًا لا NaN', () => {
    expect(percent(0, 0)).toBe(0);
    expect(percent(5, 0)).toBe(0);
  });
});

describe('تواريخ نسبية', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-07T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('daysSince', () => {
    expect(daysSince(null)).toBeNull();
    expect(daysSince(undefined)).toBeNull();
    expect(daysSince('2026-11-07T01:00:00Z')).toBe(0);
    expect(daysSince('2026-11-04T12:00:00Z')).toBe(3);
  });

  it('relativeDay', () => {
    expect(relativeDay(null)).toBe('لم يحدث بعد');
    expect(relativeDay('2026-11-07T08:00:00Z')).toBe('اليوم');
    expect(relativeDay('2026-11-06T08:00:00Z')).toBe('أمس');
    expect(relativeDay('2026-11-04T12:00:00Z')).toContain('أيام');
    expect(relativeDay('2026-10-20T12:00:00Z')).toContain('أسابيع');
    expect(relativeDay('2026-07-01T12:00:00Z')).toContain('شهور');
  });
});

describe('تنسيق', () => {
  it('الأرقام والمبالغ بالأرقام العربية', () => {
    expect(formatNumber(1234)).toMatch(/[٠-٩]/);
    expect(formatMoney(150)).toMatch(/[٠-٩]/);
  });
  it('التاريخ الفارغ شرطة', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
  });
});
