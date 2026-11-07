// معاينة التصميم ببيانات تجريبية بلا أي اتصال بـ Supabase:  npm run dev:design
// افتح الرابط الذي يطبعه. أضف ‎?login‎ لرؤية شاشة الدخول. لا يدخل أي شيء من هذا في البناء الحقيقي.
import { createServer } from 'vite';

process.env.VITE_DESIGN_MOCK = '1';
const server = await createServer({ server: { port: 5175, strictPort: false } });
await server.listen();
server.printUrls();
