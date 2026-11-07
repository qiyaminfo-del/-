import { render, renderHook, screen, act } from '@testing-library/react';
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

const navLabels = () => screen.getAllByRole('link').map((a) => a.textContent);

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  h.signOut.mockReset().mockResolvedValue({});
});

describe('القائمة السفلية تتبع دورك في المجلس النشط', () => {
  it('الطالب بلا أدوار لا يرى إلا الرئيسية', () => {
    setApp([], 'A', [circle('A')]);
    renderLayout();
    expect(navLabels()).toEqual(['الرئيسية']);
  });

  it('مسؤول الحضور يرى الحضور فقط (لا رسوم ولا إدارة)', () => {
    setApp([role('attendance_officer', 'A')], 'A', [circle('A')]);
    renderLayout();
    expect(navLabels()).toEqual(['الرئيسية', 'الحضور']);
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
      'تقرير المجلس',
      'أداء الفريق',
      'الإدارة',
    ]);
  });

  it('مدير مجلس A لا يرى أزرار الإدارة وهو في مجلس B', () => {
    setApp([role('admin', 'A')], 'B', [circle('A'), circle('B')]);
    renderLayout();
    expect(navLabels()).toEqual(['الرئيسية']);
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
