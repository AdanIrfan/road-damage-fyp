import { Button } from "./ui";

/** "N items · page x of y" with Previous/Next buttons. Renders nothing when there are no items. */
export function Pagination({
  page,
  pageSize,
  total,
  loading = false,
  noun,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  loading?: boolean;
  /** Singular noun, e.g. "report". */
  noun: string;
  onPage: (page: number) => void;
}) {
  if (total === 0) return null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-4 text-sm text-ink-600">
      <span>
        {total} {noun}
        {total === 1 ? "" : "s"} · page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1 || loading} onClick={() => onPage(page - 1)}>
          Previous
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages || loading} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
