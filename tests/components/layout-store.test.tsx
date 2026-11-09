import { render, renderHook, screen, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isConfigured: true,
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: { user: { id: 'me' } } } }),
      signOut: h.signOut,
    },
    from: () => ({ upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }) }),
  },
}));

import Layout from '@/components/Layout';
import { useApp, useIsSteward } from '@/store/session';
import type { Circle, RoleKey } from '@/lib/types';

const circle = (id: string, extra: Partial<Circle> = {}): Circle => ({
  id,
  name: `مجلس ${id}`,
  type: 'public',
  sheikh_id: null,
  schedule_rule: null,
  location: null,
  parent_circle_id: null,
  is_active: true,
  ...extra,
});

const role = (r: RoleKey, circle_id: string) => ({ id: `${r}-${circle_id}`, role: r, circle_id });

const setApp = (roles: ReturnType<typeof role>[], active: string, circles: Circle[]) =>
  useApp.setState({
    loading: false,
    auth: { user: { id: 'me' } } as never,
    profile: { id: 'me', full_name: 'محسن علي' } as never,
    roles,
    circles,
    activeCircleId: active,
    pendingSync: 0,
  });

const renderLayout = () =>
  render(
    <MemoryRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<div>محتوى</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

const sideNav = () => within(screen.getByRole('navigation', { name: 'التنقل الرئيسي' }));
const bottomNav = () => within(screen.getByRole('navigation', { name: 'التنقل السفلي' }));
const navLabels = () => sideNav().getAllByRole('link').map((a) => a.textContent);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  h.signOut.mockReset().mockResolvedValue({});
});

describe('القائمة السفلية تتبع دورك في المجلس النشط', () => {
  it('الطالب بلا أدوار لا يرى إلا الرئيسية', () => {
    setApp([], 'A', [circle('A')]);
    renderLayout();
    expect(navLabels()).toEqual(['الرئيسية', 'الأوراد']);
  });

  it('مسؤول الحضور يرى الحضور فقط (لا رسوم ولا إدارة)', () => {
    setApp([role('attendance_officer', 'A')], 'A', [circle('A')]);
    renderLayout();
    expect(navLabels()).toEqual(['الرئيسية', 'الحضور', 'الأوراد', 'التقارير']);
  });

  it('المدير يرى كل الشاشات في مجلسه', () => {
    setApp([role('admin', 'A')], 'A', [circle('A')]);
    renderLayout();
    expect(navLabels()).toEqual([
      'الرئيسية',
      'قائمتي',
      'الحضور',
      'الرسوم',
      'التكاليف',
      'التفريغ',
      'الأوراد',
      'تقرير المجلس',
      'أداء الفريق',
      'التقارير',
      'الإدارة',
    ]);
  });

  it('مدير مجلس A لا يرى أزرار الإدارة وهو في مجلس B', () => {
    setApp([role('admin', 'A')], 'B', [circle('A'), circle('B')]);
    renderLayout();
    expect(navLabels()).toEqual(['الرئيسية', 'الأوراد']);
  });

  it('مدير المجلس الأب يدير المجلس الخاص التابع له', () => {
    setApp([role('admin', 'P')], 'C', [circle('P'), circle('C', { parent_circle_id: 'P', type: 'private' })]);
    renderLayout();
    expect(navLabels()).toContain('الإدارة');
  });

  it('الشيخ يرى التقارير لكن لا يرى «الإدارة»', () => {
    setApp([role('sheikh', 'A')], 'A', [circle('A')]);
    renderLayout();
    const labels = navLabels();
    expect(labels).toContain('تقرير المجلس');
    expect(labels).not.toContain('الإدارة');
  });

  it('دور مسحوب (غير موجود في القائمة) لا يمنح شيئًا', () => {
    setApp([], 'A', [circle('A')]);
    renderLayout();
    expect(navLabels()).not.toContain('الحضور');
  });
});

describe('الشريط الجانبي والسفلي', () => {
  beforeEach(() => localStorage.removeItem('majales.sidebar'));

  it('الشريط الجانبي مقسّم إلى مجموعات بعناوين', () => {
    setApp([role('admin', 'A')], 'A', [circle('A')]);
    renderLayout();
    for (const g of ['العمل اليومي', 'الإشراف', 'الإدارة']) {
      expect(sideNav().getAllByText(g).length).toBeGreaterThan(0);
    }
  });

  it('كل رابط في الشريط له أيقونة (SVG)', () => {
    setApp([role('admin', 'A')], 'A', [circle('A')]);
    renderLayout();
    for (const a of sideNav().getAllByRole('link')) expect(a.querySelector('svg'), a.textContent ?? '').not.toBeNull();
  });

  it('الطيّ يُبقي أسماء الروابط لقارئ الشاشة، ويُحفظ التفضيل', async () => {
    setApp([role('admin', 'A')], 'A', [circle('A')]);
    renderLayout();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'طيّ الشريط' }));
    expect(localStorage.getItem('majales.sidebar')).toBe('1');
    // الأسماء ما زالت موجودة (sr-only) فتبقى الروابط قابلة للوصول
    expect(navLabels()).toContain('الرسوم');
    expect(sideNav().getByText('الرسوم')).toHaveClass('sr-only');
    await user.click(screen.getAllByRole('button', { name: 'توسيع الشريط' })[0]);
    expect(localStorage.getItem('majales.sidebar')).toBe('0');
  });

  it('التفضيل المحفوظ يُستعاد عند فتح الصفحة', () => {
    localStorage.setItem('majales.sidebar', '1');
    setApp([role('admin', 'A')], 'A', [circle('A')]);
    renderLayout();
    expect(screen.getAllByRole('button', { name: 'توسيع الشريط' }).length).toBeGreaterThan(0);
  });

  it('الشريط السفلي للهاتف: ٥ شاشات أو أقل تظهر كلها بلا «المزيد»', () => {
    setApp([role('attendance_officer', 'A')], 'A', [circle('A')]);
    renderLayout();
    expect(bottomNav().getAllByRole('link').map((a) => a.textContent)).toEqual(['الرئيسية', 'الحضور', 'الأوراد', 'التقارير']);
    expect(bottomNav().queryByRole('button', { name: /المزيد/ })).not.toBeInTheDocument();
  });

  it('أكثر من ٥ شاشات: أول ٤ + «المزيد» يفتح الباقي مع تسجيل الخروج', async () => {
    setApp([role('admin', 'A')], 'A', [circle('A')]);
    renderLayout();
    const user = userEvent.setup();
    expect(bottomNav().getAllByRole('link')).toHaveLength(4);
    await user.click(bottomNav().getByRole('button', { name: /المزيد/ }));
    const dialog = await screen.findByRole('dialog', { name: 'المزيد' });
    const rest = within(dialog).getAllByRole('link').map((a) => a.textContent);
    expect(rest).toEqual(['التكاليف', 'التفريغ', 'الأوراد', 'تقرير المجلس', 'أداء الفريق', 'التقارير', 'الإدارة']);
    expect(within(dialog).getByRole('button', { name: /خروج/ })).toBeInTheDocument();
  });

  it('الشخص يرى اسمه وأعلى أدواره', () => {
    setApp([role('finance_officer', 'A'), role('admin', 'A')], 'A', [circle('A')]);
    renderLayout();
    expect(screen.getAllByText('محسن علي').length).toBeGreaterThan(0);
    expect(screen.getAllByText('مدير المنصة').length).toBeGreaterThan(0);
  });
});

describe('useIsSteward', () => {
  const steward = () => renderHook(() => useIsSteward()).result.current;

  it('يتبع المجلس النشط', () => {
    setApp([role('admin', 'A')], 'A', [circle('A'), circle('B')]);
    expect(steward()).toBe(true);
    act(() => useApp.getState().setActiveCircle('B'));
    expect(steward()).toBe(false);
  });

  it('مسؤول عادي ليس مديرًا', () => {
    setApp([role('finance_officer', 'A')], 'A', [circle('A')]);
    expect(steward()).toBe(false);
  });
});

describe('تسجيل الخروج', () => {
  it('بلا عمليات معلّقة: يخرج فورًا ويمسح المجلس المحفوظ', async () => {
    localStorage.setItem('majales.circle', 'A');
    setApp([], 'A', [circle('A')]);
    await act(() => useApp.getState().signOut());
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('majales.circle')).toBeNull();
    expect(useApp.getState().auth).toBeNull();
  });

  describe('مع تسجيلات حضور لم تُرفع', () => {
    const queueOne = async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      const offline = await import('@/lib/offline');
      await offline.writeOrQueue('attendance', { session_id: 's', student_id: 'x', state: 'present' }, 'session_id,student_id');
      return offline;
    };

    it('الرفض يوقف الخروج ويُبقي البيانات', async () => {
      const offline = await queueOne();
      setApp([], 'A', [circle('A')]);
      vi.spyOn(window, 'confirm').mockReturnValue(false);
      await act(() => useApp.getState().signOut());
      expect(h.signOut).not.toHaveBeenCalled();
      expect(await offline.pendingCount()).toBe(1);
    });

    it('الموافقة تخرج وتمسح بيانات هذا الحساب من الجهاز', async () => {
      const offline = await queueOne();
      setApp([], 'A', [circle('A')]);
      vi.spyOn(window, 'confirm').mockReturnValue(true);
      await act(() => useApp.getState().signOut());
      expect(h.signOut).toHaveBeenCalledTimes(1);
      expect(await offline.pendingCount()).toBe(0);
    });
  });
});
