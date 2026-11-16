import { useEffect, useState } from "react";
import { apiBlob, errorMessage } from "./api";

/**
 * Report and repair photos are only served to authorised users (session cookie), never from a
 * public URL, so they are downloaded with the API client and shown from object URLs.
 *
 * A small cache keeps the most recently used photos, so a list and the detail page opened from
 * it do not download the same picture twice. Entries are revoked when they fall out of the cache.
 */
const MAX_CACHED = 40;
const cache = new Map<string, Promise<string>>();

function load(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached !== undefined) {
    // Refresh its position: the Map keeps insertion order, oldest first.
    cache.delete(url);
    cache.set(url, cached);
    return cached;
  }
  const created = apiBlob(url).then((blob) => URL.createObjectURL(blob));
  cache.set(url, created);
  created.catch(() => cache.delete(url));
  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) {
      const evicted = cache.get(oldest);
      cache.delete(oldest);
      evicted?.then((objectUrl) => URL.revokeObjectURL(objectUrl)).catch(() => undefined);
    }
  }
  return created;
}

/** `enabled` lets a caller wait (for example until a thumbnail scrolls into view). */
export function useProtectedImage(url: string, enabled = true): { src: string | undefined; error: string | undefined } {
  const [state, setState] = useState<{ url: string; src?: string; error?: string }>({ url });

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    load(url)
      .then((src) => {
        if (!cancelled) setState({ url, src });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ url, error: errorMessage(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [url, enabled]);

  // A result for a previous url is never shown for the new one.
  return state.url === url ? { src: state.src, error: state.error } : { src: undefined, error: undefined };
}
