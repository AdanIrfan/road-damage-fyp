import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="font-mono text-sm font-semibold text-cobalt-600">404</p>
      <h1 className="text-2xl font-bold text-ink-900">Page not found</h1>
      <p className="text-sm text-ink-500">The page you are looking for does not exist.</p>
      <Link to="/" className="mt-2 text-sm font-semibold text-cobalt-600 hover:text-cobalt-700">
        Go to the home page
      </Link>
    </div>
  );
}
