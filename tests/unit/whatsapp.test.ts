import { describe, expect, it, vi } from 'vitest';
import { fillTemplate, isValidPhone, normalizePhone, openWhatsApp, waLink } from '@/lib/whatsapp';

describe('normalizePhone', () => {
  it.each([
    ['01012345678', '201012345678'],
    ['+20 101 234 5678', '201012345678'],
    ['0020 101 234 5678', '201012345678'],
    ['٠١٠١٢٣٤٥٦٧٨', '201012345678'], // أرقام عربية
    ['(010) 1234-5678', '201012345678'],
    ['+966501234567', '966501234567'],
  ])('%s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each(['', '123', 'abc', '+', '0', '1234567890123456'])('يرفض «%s»', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });

  it('isValidPhone يتعامل مع null وundefined', () => {
    expect(isValidPhone(null)).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
    expect(isValidPhone('01012345678')).toBe(true);
  });
});

describe('fillTemplate', () => {
  it('يستبدل المتغيرات العربية', () => {
    expect(fillTemplate('أهلًا {اسم_الطالب} في {اسم_المجلس}', { اسم_الطالب: 'أحمد', اسم_المجلس: 'العام' })).toBe(
      'أهلًا أحمد في العام',
    );
  });

  it('يترك المتغير كما هو إن لم تُعطَ قيمة (لا يُرسل نصًا فارغًا بصمت)', () => {
    expect(fillTemplate('في {المكان}', {})).toBe('في {المكان}');
    expect(fillTemplate('في {المكان}', { المكان: '' })).toBe('في {المكان}');
    expect(fillTemplate('في {المكان}', { المكان: null })).toBe('في {المكان}');
  });

  it('يستبدل المتغير المكرر في كل مواضعه', () => {
    expect(fillTemplate('{س} و{س}', { س: 'ا' })).toBe('ا وا');
  });

  it('لا ينفّذ شيئًا من قيمة المتغير (لا استبدال متداخل)', () => {
    expect(fillTemplate('{a}', { a: '{b}', b: 'SECRET' })).toBe('{b}');
  });
});

describe('waLink / openWhatsApp', () => {
  it('يرمّز النص بشكل صحيح ويستخدم wa.me فقط', () => {
    const link = waLink('01012345678', 'مرحبا & hello?=1')!;
    expect(link.startsWith('https://wa.me/201012345678?text=')).toBe(true);
    expect(link).not.toContain(' ');
    expect(decodeURIComponent(link.split('text=')[1])).toBe('مرحبا & hello?=1');
  });

  it('رقم غير صالح → لا رابط ولا فتح نافذة', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(waLink('12', 'x')).toBeNull();
    expect(openWhatsApp('12', 'x')).toBe(false);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('يفتح بـ noopener,noreferrer (يمنع وصول الصفحة المفتوحة لنافذتنا)', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    expect(openWhatsApp('01012345678', 'x')).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/'), '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});
