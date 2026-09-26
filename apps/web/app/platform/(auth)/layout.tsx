export const metadata = { title: 'Stays Platform' };
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[380px]">
        <p className="mb-8 font-serif text-2xl tracking-tight">Stays <span className="text-muted">Platform</span></p>
        {children}
      </div>
    </main>
  );
}
