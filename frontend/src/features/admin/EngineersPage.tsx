import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Pagination } from "../../components/Pagination";
import { Alert, Badge, Button, Card, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import type { EngineerAccount, Paginated, User } from "../../lib/types";
import { formatDate, statusLabel, statusTone } from "../../utils/format";
import { CreateEngineerForm } from "./CreateEngineerForm";
import { engineersApi, type EngineerQuery } from "./engineersApi";

const PAGE_SIZE = 10;

export function EngineersPage() {
  const [query, setQuery] = useState<EngineerQuery>({ page: 1, pageSize: PAGE_SIZE });
  const [searchInput, setSearchInput] = useState("");
  const [result, setResult] = useState<Paginated<EngineerAccount>>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [busyId, setBusyId] = useState<string>();

  const load = useCallback(async (current: EngineerQuery) => {
    setLoading(true);
    setError(undefined);
    try {
      setResult(await engineersApi.list(current));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(query);
  }, [load, query]);

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    setQuery((current) => ({ ...current, page: 1, search: searchInput.trim() }));
  }

  async function toggleStatus(engineer: User) {
    const next = engineer.status === "ACTIVE" ? "DEACTIVATED" : "ACTIVE";
    if (next === "DEACTIVATED" && !window.confirm(`Deactivate ${engineer.fullName}? They will be logged out immediately.`)) return;
    setBusyId(engineer.id);
    setNotice(undefined);
    setError(undefined);
    try {
      const { engineer: updated } = await engineersApi.setStatus(engineer.id, next);
      setNotice(`${updated.fullName} is now ${statusLabel[updated.status].toLowerCase()}.`);
      await load(query);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(undefined);
    }
  }


  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Maintenance engineers</h1>
          <p className="mt-1 text-sm text-slate-500">Create engineer accounts and manage their access.</p>
        </div>
        {!showCreate && <Button onClick={() => setShowCreate(true)}>Add engineer</Button>}
      </div>

      {showCreate && (
        <Card title="New engineer" description="The engineer logs in with this mobile number and the temporary password.">
          <CreateEngineerForm
            onCancel={() => setShowCreate(false)}
            onCreated={(engineer) => {
              setShowCreate(false);
              setNotice(`Engineer account created for ${engineer.fullName}. Share the temporary password with them privately.`);
              setQuery((current) => ({ ...current, page: 1 }));
            }}
          />
        </Card>
      )}

      {notice !== undefined && <Alert tone="success">{notice}</Alert>}
      {error !== undefined && <Alert>{error}</Alert>}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <form onSubmit={handleSearch} className="flex min-w-0 flex-1 gap-2">
            <input
              type="search"
              aria-label="Search engineers"
              placeholder="Search by name or mobile number"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="block w-full min-w-0 rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
            <Button type="submit" variant="secondary">
              Search
            </Button>
          </form>
          <select
            aria-label="Filter by status"
            value={query.status ?? ""}
            onChange={(e) => {
              const value = e.target.value;
              setQuery((current) => {
                const { status: _status, ...rest } = current;
                return value === "ACTIVE" || value === "DEACTIVATED" ? { ...rest, page: 1, status: value } : { ...rest, page: 1 };
              });
            }}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
          >
            <option value="">All statuses</option>
            <option value="ACTIVE">Active</option>
            <option value="DEACTIVATED">Deactivated</option>
          </select>
        </div>

        <div className="mt-4 overflow-x-auto">
          {loading && result === undefined ? (
            <div className="flex justify-center py-10 text-blue-600">
              <Spinner />
            </div>
          ) : result !== undefined && result.items.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">
              {query.search !== undefined && query.search !== "" ? "No engineers match your search." : "No engineer accounts yet."}
            </p>
          ) : (
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4">Name</th>
                  <th className="py-2 pr-4">Mobile number</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Open jobs</th>
                  <th className="hidden py-2 pr-4 md:table-cell">Created</th>
                  <th className="py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result?.items.map((engineer) => (
                  <tr key={engineer.id} className={loading ? "opacity-60" : undefined}>
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      <Link to={`/admin/engineers/${engineer.id}`} className="hover:text-blue-700 hover:underline">
                        {engineer.fullName}
                      </Link>
                      {engineer.mustChangePassword && <div className="text-xs font-normal text-amber-700">Temporary password not changed yet</div>}
                    </td>
                    <td className="py-3 pr-4 text-slate-600">{engineer.mobileNumber}</td>
                    <td className="py-3 pr-4">
                      <Badge tone={statusTone[engineer.status]}>{statusLabel[engineer.status]}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">
                      {engineer.workload.openJobs}
                      {engineer.workload.awaitingConfirmation > 0 && (
                        <span className="block text-xs text-slate-500">{engineer.workload.awaitingConfirmation} awaiting confirmation</span>
                      )}
                    </td>
                    <td className="hidden py-3 pr-4 text-slate-500 md:table-cell">{formatDate(engineer.createdAt)}</td>
                    <td className="py-3 text-right">
                      <Button
                        variant={engineer.status === "ACTIVE" ? "secondary" : "primary"}
                        className="px-3 py-1.5"
                        loading={busyId === engineer.id}
                        onClick={() => void toggleStatus(engineer)}
                      >
                        {engineer.status === "ACTIVE" ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {result !== undefined && (
          <Pagination
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
            loading={loading}
            noun="engineer"
            onPage={(page) => setQuery((c) => ({ ...c, page }))}
          />
        )}
      </Card>
    </div>
  );
}
