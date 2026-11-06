/**
 * بناء روابط واتساب الجاهزة.
 * لا تحتاج أي واجهة برمجية مدفوعة: wa.me يفتح تطبيق واتساب برسالة معبّأة،
 * والمستخدم يراها ويعدّلها قبل الضغط على إرسال.
 */

/** تحويل الرقم المصري/العربي إلى صيغة دولية بلا رموز. */
export function normalizePhone(raw: string, defaultCountry = '20'): string | null {
  if (!raw) return null;
  // تحويل الأرقام العربية إلى لاتينية
  const latin = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  let digits = latin.replace(/[^\d+]/g, '');

  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('0')) digits = defaultCountry + digits.slice(1);

  digits = digits.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

export function isValidPhone(raw: string | null | undefined): boolean {
  return Boolean(raw && normalizePhone(raw));
}

export type TemplateVars = Record<string, string | null | undefined>;

/** استبدال المتغيرات داخل نص القالب: {اسم_الطالب} ونحوه. */
export function fillTemplate(body: string, vars: TemplateVars): string {
  return body.replace(/\{([^}]+)\}/g, (match, key: string) => {
    const value = vars[key.trim()];
    return value != null && value !== '' ? String(value) : match;
  });
}

export function waLink(phone: string, text: string): string | null {
  const n = normalizePhone(phone);
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/** فتح واتساب في تبويب جديد. يُرجع false إذا كان الرقم غير صالح. */
export function openWhatsApp(phone: string, text: string): boolean {
  const link = waLink(phone, text);
  if (!link) return false;
  window.open(link, '_blank', 'noopener,noreferrer');
  return true;
}
