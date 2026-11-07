import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  configured: true,
  signIn: vi.fn(),
  signUp: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  get isConfigured() {
    return h.configured;
  },
  supabase: { auth: { signInWithPassword: h.signIn, signUp: h.signUp } },
}));

import Login from '@/pages/Login';

beforeEach(() => {
  h.configured = true;
  h.signIn.mockReset().mockResolvedValue({ error: null });
  h.signUp.mockReset().mockResolvedValue({ error: null });
});

const fillSignIn = async (email: string, pass: string) => {
  const user = userEvent.setup();
  const [mail, pw] = [screen.getByLabelText('البريد الإلكتروني'), screen.getByLabelText('كلمة المرور')];
  await user.type(mail, email);
  await user.type(pw, pass);
  return user;
};

describe('شاشة الدخول', () => {
  it('بلا مفاتيح Supabase تعرض خطوة الإعداد بدل الانهيار', () => {
    h.configured = false;
    render(<Login />);
    expect(screen.getByText('خطوة إعداد واحدة')).toBeInTheDocument();
    expect(screen.queryByLabelText('كلمة المرور')).not.toBeInTheDocument();
  });

  it('الدخول يرسل البريد مقصوصًا من المسافات', async () => {
    render(<Login />);
    const user = await fillSignIn('  me@mail.com  ', 'secret-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(h.signIn).toHaveBeenCalledWith({ email: 'me@mail.com', password: 'secret-pass' }));
  });

  it('خطأ الدخول يظهر بالعربية ولا يتسرب نص الخادم الخام', async () => {
    h.signIn.mockResolvedValue({ error: { message: 'Invalid login credentials' } });
    render(<Login />);
    const user = await fillSignIn('a@b.com', 'wrong-pass');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    expect(await screen.findByText('البريد أو كلمة المرور غير صحيحة.')).toBeInTheDocument();
    expect(screen.queryByText(/Invalid login/)).not.toBeInTheDocument();
  });

  it('استثناء الشبكة لا يترك الزر معلقًا', async () => {
    h.signIn.mockRejectedValue(new Error('Failed to fetch'));
    render(<Login />);
    const user = await fillSignIn('a@b.com', 'whatever1');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    expect(await screen.findByText(/تعذّر الاتصال/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'دخول' })).toBeEnabled();
  });

  it('الدخول يقبل كلمة مرور قصيرة قديمة (الحد ٨ للتسجيل الجديد فقط)', async () => {
    render(<Login />);
    const user = await fillSignIn('old@mail.com', '123456');
    await user.click(screen.getByRole('button', { name: 'دخول' }));
    await waitFor(() => expect(h.signIn).toHaveBeenCalled());
  });
});

describe('إنشاء حساب', () => {
  const toSignup = async () => {
    const user = userEvent.setup();
    await user.click(screen.getByText('ليس لديك حساب؟ أنشئ واحدًا'));
    return user;
  };

  it('يرفض كلمة مرور أقل من ٨ أحرف قبل أي طلب للخادم', async () => {
    render(<Login />);
    const user = await toSignup();
    await user.type(screen.getByLabelText('الاسم الكامل'), 'محسن');
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'a@b.com');
    await user.type(screen.getByLabelText('كلمة المرور'), '1234567');
    await user.click(screen.getByRole('button', { name: 'إنشاء حساب' }));
    expect(await screen.findByText(/8 أحرف على الأقل/)).toBeInTheDocument();
    expect(h.signUp).not.toHaveBeenCalled();
  });

  it('يرسل الاسم مقصوصًا ولا يتجاوز ١٢٠ حرفًا', async () => {
    render(<Login />);
    const user = await toSignup();
    await user.type(screen.getByLabelText('الاسم الكامل'), `  ${'ا'.repeat(200)}  `);
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'a@b.com');
    await user.type(screen.getByLabelText('كلمة المرور'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'إنشاء حساب' }));
    await waitFor(() => expect(h.signUp).toHaveBeenCalled());
    const arg = h.signUp.mock.calls[0][0];
    expect(arg.options.data.full_name.length).toBeLessThanOrEqual(120);
    expect(arg.options.data.full_name).toBe(arg.options.data.full_name.trim());
    expect(arg.email).toBe('a@b.com');
  });

  it('نجاح التسجيل يُظهر رسالة التفعيل', async () => {
    render(<Login />);
    const user = await toSignup();
    await user.type(screen.getByLabelText('الاسم الكامل'), 'محسن');
    await user.type(screen.getByLabelText('البريد الإلكتروني'), 'a@b.com');
    await user.type(screen.getByLabelText('كلمة المرور'), 'long-enough-1');
    await user.click(screen.getByRole('button', { name: 'إنشاء حساب' }));
    expect(await screen.findByText(/أُنشئ الحساب/)).toBeInTheDocument();
  });

  it('حقل كلمة المرور يستخدم autocomplete الصحيح لكل وضع', async () => {
    render(<Login />);
    expect(screen.getByLabelText('كلمة المرور')).toHaveAttribute('autocomplete', 'current-password');
    await toSignup();
    expect(screen.getByLabelText('كلمة المرور')).toHaveAttribute('autocomplete', 'new-password');
  });
});
