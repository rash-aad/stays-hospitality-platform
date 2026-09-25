export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <p className="display text-5xl">Page not found</p>
        <p className="t-muted mt-3">The page you’re looking for has moved or no longer exists.</p>
        <a href="/" className="t-btn mt-8">Back to the home page</a>
      </div>
    </main>
  );
}
