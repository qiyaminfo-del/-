// يولّد supabase/setup_all.sql من ملفات الهجرة بالترتيب.
//   node scripts/build-setup.mjs          ← يكتب الملف
//   node scripts/build-setup.mjs --check  ← يفشل إن كان الملف المولَّد قديمًا (للـ CI)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase');
const migrations = readdirSync(join(root, 'migrations'))
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort();

// seed يُشغَّل بعد المخطط (0003) وقبل الإصلاحات، كما في README
const order = [];
for (const f of migrations) {
  order.push(`migrations/${f}`);
  if (f.startsWith('0003_')) order.push('seed.sql');
}

const last = migrations.at(-1).slice(0, 4);
const header = `-- ============================================================
-- منصة مجالس — كل قاعدة البيانات في ملف واحد لمشروع Supabase جديد
-- الصقه كاملًا في SQL Editor ثم اضغط Run مرة واحدة.
-- يجمع بالترتيب: ${order.map((f) => f.replace(/^migrations\/(\d{4}).*/, '$1').replace('seed.sql', 'seed')).join(' → ')}
-- يعمل كمعاملة واحدة: إما ينجح كله أو لا يتغير شيء، وإعادة تشغيله آمنة.
-- مولَّد تلقائيًا بـ npm run db:bundle من supabase/migrations (آخرها ${last}). لا تعدّله يدويًا.
-- ============================================================

begin;

-- المناظر لا تحمل بيانات؛ تُحذف لتُبنى بصيغتها الأخيرة (0005 وسّع منظر الرصيد).
drop view if exists v_officer_performance, v_enrollment_balance, v_student_attendance_stats,
  v_task_completion, v_session_attendance_summary, v_session_contacts cascade;
`;

const body = order
  .map((f) => `\n-- >>>>>>>>>>>>>>>>>>>> ${f} >>>>>>>>>>>>>>>>>>>>\n\n${readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n')}`)
  .join('');

const out = `${header}${body}\ncommit;\n`;
const target = join(root, 'setup_all.sql');

if (process.argv.includes('--check')) {
  const current = existsSync(target) ? readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
  if (current !== out) {
    console.error('supabase/setup_all.sql قديم. شغّل: npm run db:bundle');
    process.exit(1);
  }
  console.log('setup_all.sql محدّث.');
} else {
  writeFileSync(target, out);
  console.log(`كُتب ${target} (${order.length} ملفات)`);
}
