/** bookEZ brand: a key in a rounded square (check-in made easy) and the "bookEZ" wordmark. */
export const BRAND = { name: 'bookEZ', domain: 'bookez.in' } as const;

export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <rect width="64" height="64" rx="16" fill="#0e5a57" />
      <circle cx="22" cy="32" r="9" fill="none" stroke="#fff" strokeWidth="6" />
      <path d="M30 29h22v6H47v9h-6v-9h-3v6h-5v-6h-3z" fill="#fff" />
    </svg>
  );
}

/** Wordmark: "book" in ink, "EZ" in the accent. `tone="light"` for dark backgrounds. */
export function Logo({ size = 'md', tone = 'ink', suffix }: { size?: 'sm' | 'md' | 'lg'; tone?: 'ink' | 'light'; suffix?: string }) {
  const px = { sm: 20, md: 26, lg: 34 }[size];
  const text = { sm: 'text-[17px]', md: 'text-[22px]', lg: 'text-[30px]' }[size];
  return (
    <span className="inline-flex items-center gap-2" aria-label={`bookEZ${suffix ? ` ${suffix}` : ''}`}>
      <BrandMark size={px} />
      <span className={`${text} font-sans leading-none font-semibold tracking-tight ${tone === 'light' ? 'text-white' : 'text-ink'}`} aria-hidden="true">
        book<span className={tone === 'light' ? 'text-[#9fd3cc]' : 'text-accent'}>EZ</span>
        {suffix && <span className={`ml-1.5 font-normal ${tone === 'light' ? 'text-white/60' : 'text-muted'}`}>{suffix}</span>}
      </span>
    </span>
  );
}
