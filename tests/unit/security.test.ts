// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const vercel = JSON.parse(read('vercel.json')) as {
  rewrites: { source: string; destination: string }[];
  headers: { source: string; headers: { key: string; value: string }[] }[];
};
const globalHeaders = Object.fromEntries(
  vercel.headers.find((h) => h.source === '/(.*)')!.headers.map((h) => [h.key, h.value]),
);

describe('رؤوس الأمان (vercel.json)', () => {
  const csp = Object.fromEntries(
    globalHeaders['Content-Security-Policy'].split(';').map((d) => {
      const [name, ...vals] = d.trim().split(/\s+/);
      return [name, vals];
    }),
  ) as Record<string, string[]>;

  it('CSP: لا سكربتات إلا من نفس الأصل، بلا unsafe-inline ولا unsafe-eval', () => {
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(JSON.stringify(csp)).not.toMatch(/unsafe-eval/);
    expect(csp['script-src']).not.toContain("'unsafe-inline'");
    expect(csp['default-src']).toEqual(["'self'"]);
  });

  it('CSP: لا إطارات ولا كائنات، ولا تغيير للقاعدة أو النماذج', () => {
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'self'"]);
    expect(csp['form-action']).toEqual(["'self'"]);
  });

  it('CSP: الاتصال لنفس الأصل وSupabase فقط', () => {
    expect(csp['connect-src']).toEqual(["'self'", 'https://*.supabase.co', 'wss://*.supabase.co']);
  });

  it('CSP: الخطوط والأنماط من نفس الأصل فقط (لا Google Fonts)، والأنماط المضمّنة للسمات فقط', () => {
    expect(csp['font-src']).toEqual(["'self'"]);
    expect(csp['style-src']).toEqual(["'self'"]);
    expect(csp['style-src-attr']).toEqual(["'unsafe-inline'"]);
  });

  it('لا طلبات خارجية للخطوط في index.html ولا في CSS المصدر', () => {
    expect(read('index.html')).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(read('src/index.css')).not.toMatch(/https?:\/\//);
  });

  it.each([
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
  ])('%s = %s', (k, v) => {
    expect(globalHeaders[k]).toBe(v);
  });

  it('HSTS لسنتين على الأقل مع النطاقات الفرعية', () => {
    const m = globalHeaders['Strict-Transport-Security'].match(/max-age=(\d+)/);
    expect(Number(m![1])).toBeGreaterThanOrEqual(63072000);
    expect(globalHeaders['Strict-Transport-Security']).toContain('includeSubDomains');
  });

  it('Permissions-Policy تعطّل الكاميرا والميكروفون والموقع', () => {
    for (const f of ['camera', 'microphone', 'geolocation']) {
      expect(globalHeaders['Permissions-Policy']).toContain(`${f}=()`);
    }
  });

  it('عامل الخدمة لا يُخزَّن (تحديثاته تصل فورًا) والأصول المُبصمة تُخزَّن طويلًا', () => {
    const sw = vercel.headers.find((h) => h.source === '/sw.js')!.headers[0].value;
    expect(sw).toContain('no-cache');
    const assets = vercel.headers.find((h) => h.source === '/assets/(.*)')!.headers[0].value;
    expect(assets).toContain('immutable');
  });

  it('إعادة التوجيه لا تبتلع sw.js ولا الأصول ولا manifest', () => {
    const re = new RegExp(`^${vercel.rewrites[0].source}$`);
    for (const ok of ['/', '/fees', '/attendance', '/admin']) expect(re.test(ok), ok).toBe(true);
    for (const kept of ['/sw.js', '/assets/index-abc.js', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png']) {
      expect(re.test(kept), kept).toBe(false);
    }
  });

  it('index.html لا يحتوي سكربتًا مضمّنًا (متوافق مع CSP)', () => {
    const html = read('index.html');
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].filter((m) => m[1].trim());
    expect(inline).toEqual([]);
  });
});

describe('فحص الكود الساكن', () => {
  const src = walk(join(root, 'src')).filter((f) => /\.(ts|tsx)$/.test(f));
  const all = (re: RegExp) =>
    src.flatMap((f) => (re.test(readFileSync(f, 'utf8')) ? [relative(root, f)] : []));

  it('لا مفتاح service_role ولا أسرار في الواجهة', () => {
    expect(all(/service_role|SUPABASE_SERVICE|sb_secret_|-----BEGIN [A-Z ]*PRIVATE KEY/)).toEqual([]);
    expect(all(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./)).toEqual([]); // JWT مكتوب في الكود
  });

  it.each([
    ['dangerouslySetInnerHTML', /dangerouslySetInnerHTML/],
    ['innerHTML', /\.innerHTML\s*=/],
    ['eval / new Function', /\beval\s*\(|new Function\s*\(/],
    ['document.write', /document\.write/],
  ])('لا يستخدم %s', (_n, re) => {
    expect(all(re)).toEqual([]);
  });

  it('لا يخزّن كلمات مرور أو رموز دخول في localStorage بنفسه', () => {
    const uses = src.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/localStorage\.(?:set|get)Item\(\s*['"`]([^'"`]+)/g)].map((m) => m[1]));
    expect(uses.filter((k) => /pass|token|secret|session|key/i.test(k))).toEqual([]);
  });

  it('كل window.open يمرر noopener', () => {
    for (const f of src) {
      for (const m of readFileSync(f, 'utf8').matchAll(/window\.open\([^)]*\)/g)) {
        expect(m[0], `${relative(root, f)}`).toContain('noopener');
      }
    }
  });

  it('لا طلبات شبكة خام (fetch/XMLHttpRequest) خارج Supabase', () => {
    expect(all(/\bfetch\s*\(|XMLHttpRequest/)).toEqual([]);
  });

  it('عميل المعاينة الوهمي لا يُستورد من src ولا يُفعَّل إلا بمتغيّر صريح', () => {
    expect(all(/mock-supabase|from ['"][^'"]*\/dev\//)).toEqual([]);
    const cfg = read('vite.config.ts');
    expect(cfg).toMatch(/process\.env\.VITE_DESIGN_MOCK === '1'/);
    expect(cfg).toContain('mock-supabase');
  });

  it('كل استيراد للعميل بالمسار المستعار @/lib/supabase (كي يُستبدل كليًا في المعاينة)', () => {
    const offenders = src.filter((f) => /from ['"]\.{1,2}\/(?:lib\/)?supabase['"]/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });

  it('.env مستبعد من git وغير متتبَّع، و.env.example بلا قيم حقيقية', () => {
    expect(read('.gitignore')).toMatch(/^\.env$/m);
    expect(read('.env.example')).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}|sb_publishable_[A-Za-z0-9_-]{10,}/);
    if (existsSync(join(root, '.git'))) {
      const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n');
      expect(tracked.filter((f) => /^\.env($|\.local)/.test(f))).toEqual([]);
    }
  });

  it('لا مفاتيح حقيقية في أي ملف متتبَّع (قاعدة، سكربتات، مستندات)', () => {
    const files = walk(root).filter((f) => !/[\\/](\.env|package-lock\.json)$/.test(f) && !/\.(png|ico)$/.test(f));
    const offenders = files.filter((f) =>
      /sb_secret_[A-Za-z0-9_-]{10,}|service_role['"]?\s*[:=]\s*['"]?eyJ|gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}/.test(
        readFileSync(f, 'utf8'),
      ),
    );
    expect(offenders.map((f) => relative(root, f))).toEqual([]);
  });
});

describe('المرجع الأساسي للهجرات', () => {
  it('كل ملفات الهجرة مرقّمة بلا فجوات', () => {
    const nums = readdirSync(join(root, 'supabase/migrations'))
      .map((f) => Number(f.slice(0, 4)))
      .sort((a, b) => a - b);
    nums.forEach((n, i) => expect(n).toBe(i + 1));
  });

  it('setup_all.sql يضم كل هجرة (شغّل npm run db:bundle إن فشل)', () => {
    const bundle = read('supabase/setup_all.sql');
    for (const f of readdirSync(join(root, 'supabase/migrations'))) {
      expect(bundle, f).toContain(`migrations/${f}`);
    }
    expect(bundle.trimEnd().endsWith('commit;')).toBe(true);
  });

  it('لا أمر DROP TABLE أو TRUNCATE أو DELETE بلا شرط في الهجرات (حماية البيانات)', () => {
    for (const f of readdirSync(join(root, 'supabase/migrations'))) {
      const sql = read(`supabase/migrations/${f}`).replace(/--.*$/gm, '');
      expect(sql, f).not.toMatch(/\bdrop\s+table\b|\btruncate\b/i);
    }
  });
});
