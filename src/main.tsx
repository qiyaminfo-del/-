import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// يفتح التطبيق بلا إنترنت في قاعات ضعيفة الشبكة. في التطوير يعطّل إعادة التحميل الفوري، فنسجّله في الإنتاج فقط.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[مجالس] تعذّر تسجيل عامل الخدمة', e));
  });
}
