import type { DueStatus } from './types';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral';

export const DUE_TONE: Record<DueStatus | 'none', Tone> = {
  paid: 'good',
  partial: 'warn',
  unpaid: 'bad',
  exempt: 'info',
  none: 'neutral',
};

/** حالة الرسوم من أرقامها (نفس قاعدة v_fee_dues في القاعدة) */
export function dueStatus(amount: number, exempt: number, paid: number): DueStatus {
  if (exempt >= amount) return 'exempt';
  if (paid >= amount - exempt) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}

/** تحقق مبلغ الدفعة قبل الإرسال: موجب، وبحد أقصى المتبقي، وبقرشين على الأكثر */
export function paymentError(raw: string, remaining: number): string | null {
  const v = Number(raw);
  if (!raw.trim() || !Number.isFinite(v)) return 'اكتب المبلغ.';
  if (v <= 0) return 'المبلغ يجب أن يكون أكبر من صفر.';
  if (Math.round(v * 100) !== v * 100) return 'المبلغ بقرشين على الأكثر.';
  if (v > remaining + 1e-9) return `المبلغ أكبر من المتبقي (${remaining}).`;
  return null;
}

/** تحقق الإعفاء: بين صفر وكامل المبلغ، ولا يجعل المدفوع أكبر من الصافي، وبسبب مكتوب */
export function exemptionError(raw: string, reason: string, amount: number, paid: number): string | null {
  const v = Number(raw);
  if (!raw.trim() || !Number.isFinite(v) || v < 0) return 'اكتب مبلغ الإعفاء.';
  if (v > amount) return 'الإعفاء أكبر من المبلغ المستحق.';
  if (paid > amount - v) return `المدفوع (${paid}) أكبر من الصافي بعد هذا الإعفاء. اعكس دفعة أولًا.`;
  if (v > 0 && !reason.trim()) return 'اكتب سبب الإعفاء.';
  return null;
}
