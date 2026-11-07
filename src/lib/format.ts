const dateFmt = new Intl.DateTimeFormat('ar-EG', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});

const timeFmt = new Intl.DateTimeFormat('ar-EG', { hour: 'numeric', minute: '2-digit' });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dateFmt.format(new Date(iso));
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
}

export function formatMoney(n: number, currency = 'EGP'): string {
  return new Intl.NumberFormat('ar-EG', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('ar-EG').format(n);
}

export function percent(part: number, total: number): number {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

export function relativeDay(iso: string | null | undefined): string {
  if (!iso) return 'لم يحدث بعد';
  const diff = new Date(iso).getTime() - Date.now();

  // المستقبل: «بعد ٣ أيام». التقريب بالأعلى كي لا يُقال «اليوم» لموعد بعد ٢٠ ساعة
  if (diff > 0) {
    const d = Math.ceil(diff / 86_400_000);
    if (d <= 1) return 'اليوم أو غدًا';
    if (d === 2) return 'بعد يومين';
    if (d < 7) return `بعد ${formatNumber(d)} أيام`;
    if (d < 30) return `بعد ${formatNumber(Math.ceil(d / 7))} أسابيع`;
    return `بعد ${formatNumber(Math.ceil(d / 30))} شهور`;
  }

  const d = daysSince(iso) ?? 0;
  if (d === 0) return 'اليوم';
  if (d === 1) return 'أمس';
  if (d < 7) return `منذ ${formatNumber(d)} أيام`;
  if (d < 30) return `منذ ${formatNumber(Math.floor(d / 7))} أسابيع`;
  return `منذ ${formatNumber(Math.floor(d / 30))} شهور`;
}

export function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
