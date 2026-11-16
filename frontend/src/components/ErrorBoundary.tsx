import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Catches a rendering error anywhere in the app and shows a recoverable message instead of a
 * blank page. Uses plain markup only, so it cannot fail for the same reason as the page did.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Unexpected error while rendering", error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <h1 className="text-2xl font-bold text-ink-900">Something went wrong</h1>
        <p className="max-w-sm text-sm text-ink-500">The page could not be shown. Your data is safe. Reload the page to continue.</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 inline-flex min-h-10 items-center rounded-lg bg-cobalt-600 px-4 text-sm font-semibold text-white hover:bg-cobalt-700"
        >
          Reload the page
        </button>
      </div>
    );
  }
}
