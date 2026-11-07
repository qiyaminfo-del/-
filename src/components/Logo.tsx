/** شعار «مجالس»: محراب بمصباح. يُستخدم في الشريط الجانبي والدخول. */
export function LogoMark({ size = 36, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden="true" className={className}>
      <defs>
        <linearGradient id="lm-gold" x1="8" y1="4" x2="40" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e3c785" />
          <stop offset="1" stopColor="#b18a3d" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="#162c25" />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="12.25" stroke="url(#lm-gold)" strokeOpacity=".55" strokeWidth="1.5" />
      <circle cx="24" cy="9.5" r="2" fill="url(#lm-gold)" />
      <path
        d="M13 36V24.5C13 18.7 17.9 14.5 24 14.5s11 4.2 11 10V36"
        stroke="url(#lm-gold)"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M18.5 36V25.6c0-3.1 2.4-5.4 5.5-5.4s5.5 2.3 5.5 5.4V36" fill="url(#lm-gold)" fillOpacity=".2" />
      <path d="M10.5 36.5h27" stroke="url(#lm-gold)" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function Wordmark({ className = '' }: { className?: string }) {
  return <span className={`display text-[26px] leading-none ${className}`}>مجالس</span>;
}
