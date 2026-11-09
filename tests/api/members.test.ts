// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as shared from '@/lib/members';

const h = vi.hoisted(() => ({
  user: { id: 'caller-1' } as { id: string } | null,
  rpc: {} as Record<string, { data: unknown; error: unknown }>,
  rolesInsertError: null as unknown,
  insertedRoles: [] as unknown[],
  createUser: vi.fn(),
  updateUserById: vi.fn(),
  deleteUser: vi.fn(),
  clients: [] as { key: string; headers?: Record<string, string> }[],
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string, opts: { global?: { headers?: Record<string, string> } }) => {
    h.clients.push({ key, headers: opts?.global?.headers });
    if (key === 'SECRET') {
      return { auth: { admin: { createUser: h.createUser, updateUserById: h.updateUserById, deleteUser: h.deleteUser } } };
    }
    return {
      auth: { getUser: async () => (h.user ? { data: { user: h.user }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }) },
      rpc: async (name: string) => h.rpc[name] ?? { data: null, error: { message: 'no rpc' } },
      from: () => ({
        insert: async (rows: unknown[]) => {
          h.insertedRoles.push(...rows);
          return { error: h.rolesInsertError };
        },
      }),
    };
  },
}));

import * as api from '../../api/members';

const CIRCLE = '11111111-1111-4111-8111-111111111111';
const TARGET = '22222222-2222-4222-8222-222222222222';

const call = (body: unknown, token: string | null = 'jwt-token') =>
  api.POST(
    new Request('https://x/api/members', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  );
const json = async (r: Response) => ({ status: r.status, body: (await r.json()) as Record<string, unknown> });

const validCreate = {
  action: 'create',
  circle_id: CIRCLE,
  full_name: 'هشام عبد العزيز',
  username: 'Hesham.A',
  password: 'strong-pass-1',
  roles: ['attendance_officer', 'sheikh'],
};

beforeEach(() => {
  process.env.VITE_SUPABASE_URL = 'https://p.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'ANON';
  process.env.SUPABASE_SECRET_KEY = 'SECRET';
  h.user = { id: 'caller-1' };
  h.rpc = {
    is_circle_admin: { data: true, error: null },
    member_manageable: { data: true, error: null },
    set_member_disabled: { data: null, error: null },
  };
  h.rolesInsertError = null;
  h.insertedRoles = [];
  h.clients = [];
  h.createUser.mockReset().mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null });
  h.updateUserById.mockReset().mockResolvedValue({ data: {}, error: null });
  h.deleteUser.mockReset().mockResolvedValue({ data: {}, error: null });
});

describe('الحماية الأساسية', () => {
  it('بلا مفتاح سري في البيئة: رسالة إعداد واضحة ولا شيء يُنفَّذ', async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    const r = await json(await call(validCreate));
    expect(r.status).toBe(503);
    expect(r.body.error).toContain('SUPABASE_SECRET_KEY');
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it('بلا رمز دخول → 401', async () => {
    expect((await call(validCreate, null)).status).toBe(401);
  });

  it('رمز دخول غير صالح → 401', async () => {
    h.user = null;
    expect((await call(validCreate)).status).toBe(401);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it('طلب بصيغة خاطئة أو كبير جدًا → 400 / 413', async () => {
    expect((await call('{not json')).status).toBe(400);
    expect((await call({ action: 'create', pad: 'x'.repeat(11_000) })).status).toBe(413);
    expect((await call({ action: 'drop_db' })).status).toBe(400);
  });

  it('طريقة GET مرفوضة', () => {
    expect(api.GET().status).toBe(405);
  });

  it('عميل المستخدم يحمل رمزه هو، والمفتاح السري لعميل الإدارة فقط', async () => {
    await call(validCreate);
    const userClient = h.clients.find((c) => c.key === 'ANON')!;
    expect(userClient.headers?.Authorization).toBe('Bearer jwt-token');
    expect(h.clients.filter((c) => c.key === 'SECRET').every((c) => !c.headers?.Authorization)).toBe(true);
  });
});

describe('إنشاء عضو', () => {
  it('ينشئ الحساب ببريد داخلي من اسم المستخدم، ويُسند الأدوار برمز المدير', async () => {
    const r = await json(await call(validCreate));
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ id: 'new-user', username: 'hesham.a' });
    expect(h.createUser).toHaveBeenCalledWith({
      email: `hesham.a@${api.MEMBER_EMAIL_DOMAIN}`,
      password: 'strong-pass-1',
      email_confirm: true,
      user_metadata: { full_name: 'هشام عبد العزيز' },
      app_metadata: { username: 'hesham.a', account_kind: 'staff' },
    });
    expect(h.insertedRoles).toEqual([
      { profile_id: 'new-user', circle_id: CIRCLE, role: 'attendance_officer', granted_by: 'caller-1' },
      { profile_id: 'new-user', circle_id: CIRCLE, role: 'sheikh', granted_by: 'caller-1' },
    ]);
  });

  it('كلمة المرور لا تُعاد في الرد أبدًا', async () => {
    const r = await json(await call(validCreate));
    expect(JSON.stringify(r.body)).not.toContain('strong-pass-1');
  });

  it('غير المدير → 403 ولا حساب يُنشأ', async () => {
    h.rpc.is_circle_admin = { data: false, error: null };
    const r = await json(await call(validCreate));
    expect(r.status).toBe(403);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it.each([
    ['مجلس غير صالح', { circle_id: 'x' }],
    ['اسم فارغ', { full_name: '  ' }],
    ['اسم مستخدم بمسافة', { username: 'a b' }],
    ['اسم مستخدم قصير', { username: 'ab' }],
    ['اسم مستخدم عربي', { username: 'محمد' }],
    ['كلمة مرور قصيرة', { password: '1234567' }],
    ['كلمة مرور طويلة جدًا', { password: 'x'.repeat(73) }],
    ['بلا أدوار', { roles: [] }],
    ['دور «طالب» لا يُسند كعامل', { roles: ['student'] }],
    ['دور مختلَق', { roles: ['superuser'] }],
  ])('يرفض: %s', async (_n, patch) => {
    const r = await call({ ...validCreate, ...patch });
    expect(r.status).toBe(400);
    expect(h.createUser).not.toHaveBeenCalled();
  });

  it('اسم مستخدم مكرر → 409 برسالة عربية', async () => {
    h.createUser.mockResolvedValue({ data: { user: null }, error: { message: 'A user with this email address has already been registered' } });
    const r = await json(await call(validCreate));
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('مستخدم من قبل');
  });

  it('فشل إسناد الأدوار يحذف الحساب المنشأ (لا حساب يتيم)', async () => {
    h.rolesInsertError = { message: 'rls' };
    const r = await call(validCreate);
    expect(r.status).toBe(403);
    expect(h.deleteUser).toHaveBeenCalledWith('new-user');
  });
});

describe('كلمة المرور والتعطيل', () => {
  it('تغيير كلمة المرور لمن تسمح القاعدة بإدارته فقط', async () => {
    expect((await call({ action: 'set_password', target_id: TARGET, password: 'new-pass-123' })).status).toBe(200);
    expect(h.updateUserById).toHaveBeenCalledWith(TARGET, { password: 'new-pass-123' });

    h.updateUserById.mockClear();
    h.rpc.member_manageable = { data: false, error: null };
    expect((await call({ action: 'set_password', target_id: TARGET, password: 'new-pass-123' })).status).toBe(403);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it('كلمة مرور جديدة ضعيفة أو هدف غير صالح → 400', async () => {
    expect((await call({ action: 'set_password', target_id: TARGET, password: 'short' })).status).toBe(400);
    expect((await call({ action: 'set_password', target_id: 'nope', password: 'long-enough-1' })).status).toBe(400);
  });

  it('التعطيل: القاعدة أولًا ثم منع الدخول، والتفعيل يرفع الحظر', async () => {
    expect((await call({ action: 'set_disabled', target_id: TARGET, disabled: true })).status).toBe(200);
    expect(h.updateUserById).toHaveBeenLastCalledWith(TARGET, { ban_duration: '876000h' });
    await call({ action: 'set_disabled', target_id: TARGET, disabled: false });
    expect(h.updateUserById).toHaveBeenLastCalledWith(TARGET, { ban_duration: 'none' });
  });

  it('إن رفضت القاعدة التعطيل لا يُحظر أحد', async () => {
    h.rpc.set_member_disabled = { data: null, error: { message: 'denied' } };
    expect((await call({ action: 'set_disabled', target_id: TARGET, disabled: true })).status).toBe(403);
    expect(h.updateUserById).not.toHaveBeenCalled();
  });

  it('قيمة التعطيل يجب أن تكون منطقية', async () => {
    expect((await call({ action: 'set_disabled', target_id: TARGET, disabled: 'yes' })).status).toBe(400);
  });
});

describe('تطابق الثوابت بين الخادم والواجهة', () => {
  it('نفس النطاق الداخلي ونفس صيغة اسم المستخدم', () => {
    expect(api.MEMBER_EMAIL_DOMAIN).toBe(shared.MEMBER_EMAIL_DOMAIN);
    expect(api.USERNAME_RE.source).toBe(shared.USERNAME_RE.source);
  });

  it('خانة الدخول: اسم المستخدم يتحول لبريده الداخلي، والبريد يبقى كما هو', () => {
    expect(shared.toLoginEmail('  Hesham.A ')).toBe(`hesham.a@${shared.MEMBER_EMAIL_DOMAIN}`);
    expect(shared.toLoginEmail('me@mail.com')).toBe('me@mail.com');
    expect(shared.usernameError('ok_name')).toBeNull();
    expect(shared.usernameError('x')).not.toBeNull();
    expect(shared.passwordError('1234567')).not.toBeNull();
  });
});
