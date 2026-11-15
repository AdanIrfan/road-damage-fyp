import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useSearchParams } from "react-router";
import { Alert, Badge, Button, Spinner } from "../../components/ui";
import { errorMessage } from "../../lib/api";
import { ChatSocketClient, type ConnectionStatus } from "../../lib/chatSocket";
import { CHAT_MESSAGE_MAX_LENGTH, type ChatContact, type ChatMessage, type Conversation } from "../../lib/chatTypes";
import { formatDate, roleLabel } from "../../utils/format";
import { useCurrentUser } from "../auth/AuthContext";
import { chatApi } from "./chatApi";

/** One row in the contact list: an active contact and/or an existing conversation. */
interface Entry {
  contact: ChatContact;
  conversation: Conversation | undefined;
}

interface PendingMessage {
  clientId: string;
  conversationId: string;
  body: string;
  failed?: string;
}

interface Thread {
  conversationId: string;
  messages: ChatMessage[];
  hasMore: boolean;
}

/** Oldest first, no duplicates (a message can arrive by push and by REST catch-up). */
function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Connected",
  reconnecting: "Reconnecting…",
  stopped: "Disconnected",
};

/**
 * Admin–engineer chat. Admins see engineers, engineers see administrators. Each pair has its own
 * private conversation. Message text is always rendered as plain text (React escapes it).
 */
export function ChatPage() {
  const me = useCurrentUser();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedContactId = searchParams.get("with");

  const [contacts, setContacts] = useState<ChatContact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string>();
  const [thread, setThread] = useState<Thread>();
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string>();
  const [pending, setPending] = useState<PendingMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [statusReason, setStatusReason] = useState<string>();
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const socketRef = useRef<ChatSocketClient | undefined>(undefined);
  const threadRef = useRef<Thread | undefined>(undefined);
  threadRef.current = thread;
  const bottomRef = useRef<HTMLDivElement>(null);

  const loadLists = useCallback(async () => {
    try {
      const [c, v] = await Promise.all([chatApi.contacts(), chatApi.conversations()]);
      setContacts(c.contacts);
      setConversations(v.conversations);
      setListError(undefined);
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setListLoading(false);
    }
  }, []);

  /** Fetches everything after the newest message we have (after a reconnect), or the latest page. */
  const catchUp = useCallback(async (conversationId: string) => {
    const current = threadRef.current;
    if (current === undefined || current.conversationId !== conversationId) return;
    let after = current.messages.at(-1)?.id;
    for (let page = 0; page < 20; page++) {
      const result = after === undefined ? await chatApi.messages(conversationId) : await chatApi.messages(conversationId, { after });
      setThread((t) => (t?.conversationId === conversationId ? { ...t, messages: mergeMessages(t.messages, result.messages) } : t));
      if (after === undefined || !result.hasMore || result.messages.length === 0) break;
      after = result.messages.at(-1)?.id;
    }
  }, []);

  // Lists + WebSocket for the lifetime of the page.
  useEffect(() => {
    void loadLists();
    const client = new ChatSocketClient({
      onStatus: (next, reason) => {
        setStatus(next);
        setStatusReason(reason);
      },
      onConnected: () => {
        // Missed while disconnected: conversation order/previews and the open thread.
        void loadLists();
        const open = threadRef.current;
        if (open !== undefined) void catchUp(open.conversationId).catch(() => undefined);
      },
      onMessage: (message) => receive(message),
      onAck: (clientId, message) => {
        setPending((list) => list.filter((p) => p.clientId !== clientId));
        receive(message);
      },
      onError: (clientId, _code, text) => {
        if (clientId === undefined) return;
        setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, failed: text } : p)));
      },
    });
    socketRef.current = client;
    client.start();
    return () => {
      client.stop();
      socketRef.current = undefined;
    };

    function receive(message: ChatMessage) {
      setThread((t) => (t?.conversationId === message.conversationId ? { ...t, messages: mergeMessages(t.messages, [message]) } : t));
      setConversations((list) => {
        const found = list.find((c) => c.id === message.conversationId);
        if (found === undefined) {
          // A conversation someone else just started: reload to learn its contact.
          void loadLists();
          return list;
        }
        const updated = { ...found, lastMessage: message, lastMessageAt: message.createdAt };
        return [updated, ...list.filter((c) => c.id !== message.conversationId)];
      });
    }
  }, [loadLists, catchUp]);

  const entries = useMemo<Entry[]>(() => {
    const byContact = new Map<string, Entry>();
    for (const conversation of conversations) byContact.set(conversation.contact.id, { contact: conversation.contact, conversation });
    for (const contact of contacts) if (!byContact.has(contact.id)) byContact.set(contact.id, { contact, conversation: undefined });
    return [...byContact.values()].sort(
      (a, b) =>
        (b.conversation?.lastMessageAt ?? "").localeCompare(a.conversation?.lastMessageAt ?? "") ||
        a.contact.fullName.localeCompare(b.contact.fullName),
    );
  }, [contacts, conversations]);

  const selected = entries.find((e) => e.contact.id === selectedContactId);

  // Open (or create) the conversation for the selected contact and load its latest messages.
  useEffect(() => {
    if (selectedContactId === null || listLoading) {
      setThread(undefined);
      return;
    }
    let cancelled = false;
    setThreadLoading(true);
    setThreadError(undefined);
    (async () => {
      const existing = conversations.find((c) => c.contact.id === selectedContactId);
      const conversation = existing ?? (await chatApi.open(selectedContactId)).conversation;
      if (existing === undefined && !cancelled) setConversations((list) => [...list, conversation]);
      const page = await chatApi.messages(conversation.id);
      if (!cancelled) setThread({ conversationId: conversation.id, messages: page.messages, hasMore: page.hasMore });
    })()
      .catch((error: unknown) => {
        if (!cancelled) {
          setThread(undefined);
          setThreadError(errorMessage(error));
        }
      })
      .finally(() => {
        if (!cancelled) setThreadLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only when the selection changes (not on every list update).
  }, [selectedContactId, listLoading]);

  // Keep the newest message in view.
  const threadMessageCount = thread?.messages.length ?? 0;
  const threadPendingCount = pending.filter((p) => p.conversationId === thread?.conversationId).length;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [threadMessageCount, threadPendingCount]);

  async function loadEarlier() {
    if (thread === undefined || thread.messages.length === 0) return;
    setLoadingEarlier(true);
    try {
      const page = await chatApi.messages(thread.conversationId, { before: thread.messages[0]?.id ?? "" });
      setThread((t) => (t?.conversationId === thread.conversationId ? { ...t, messages: mergeMessages(page.messages, t.messages), hasMore: page.hasMore } : t));
    } catch (error) {
      setThreadError(errorMessage(error));
    } finally {
      setLoadingEarlier(false);
    }
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    const body = draft.trim();
    if (thread === undefined || body === "" || body.length > CHAT_MESSAGE_MAX_LENGTH || socketRef.current === undefined) return;
    const clientId = socketRef.current.send(thread.conversationId, body);
    setPending((list) => [...list, { clientId, conversationId: thread.conversationId, body }]);
    setDraft("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function retry(item: PendingMessage) {
    setPending((list) => list.map((p) => (p.clientId === item.clientId ? { ...p, failed: undefined } : p)));
    socketRef.current?.retry(item.clientId, item.conversationId, item.body);
  }

  const select = (contactId: string | null) => setSearchParams(contactId === null ? {} : { with: contactId }, { replace: false });
  const counterpart = me.role === "ADMIN" ? "engineers" : "administrators";
  const canSend = selected?.contact.status === "ACTIVE" && status !== "stopped";
  const threadPending = pending.filter((p) => p.conversationId === thread?.conversationId);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
          <p className="mt-1 text-sm text-slate-500">Private conversations with {counterpart}. Only the two of you can see a conversation.</p>
        </div>
        <span className="flex items-center gap-2 text-sm text-slate-500" role="status">
          <span className={`size-2 rounded-full ${status === "open" ? "bg-green-500" : status === "stopped" ? "bg-red-500" : "bg-amber-500"}`} aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
      </div>
      {statusReason !== undefined && <Alert>{statusReason}</Alert>}
      {listError !== undefined && <Alert>{listError}</Alert>}

      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        {/* Contact list (hidden on small screens while a conversation is open) */}
        <aside className={`rounded-lg border border-slate-200 bg-white shadow-sm ${selectedContactId !== null ? "hidden md:block" : ""}`}>
          <h2 className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-slate-900">{me.role === "ADMIN" ? "Engineers" : "Administrators"}</h2>
          {listLoading ? (
            <div className="flex justify-center py-8 text-blue-600">
              <Spinner />
            </div>
          ) : entries.length === 0 ? (
            <p className="px-4 py-6 text-sm text-slate-500">No active {counterpart} to message yet.</p>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {entries.map(({ contact, conversation }) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => select(contact.id)}
                    aria-current={contact.id === selectedContactId ? "true" : undefined}
                    className={`block w-full px-4 py-3 text-left transition hover:bg-slate-50 ${contact.id === selectedContactId ? "bg-blue-50" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-900">{contact.fullName}</span>
                      {contact.status !== "ACTIVE" && <Badge tone="red">Deactivated</Badge>}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-slate-500">
                      {conversation?.lastMessage
                        ? `${conversation.lastMessage.senderId === me.id ? "You: " : ""}${conversation.lastMessage.body}`
                        : "No messages yet"}
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* Conversation */}
        <section className={`flex min-h-[60vh] flex-col rounded-lg border border-slate-200 bg-white shadow-sm ${selectedContactId === null ? "hidden md:flex" : ""}`}>
          {selectedContactId === null ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-slate-500">Choose someone to start or continue a conversation.</div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
                <button type="button" className="rounded-md px-2 py-1 text-sm text-blue-700 hover:bg-blue-50 md:hidden" onClick={() => select(null)}>
                  ← Back
                </button>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{selected?.contact.fullName ?? "Conversation"}</div>
                  {selected !== undefined && <div className="text-xs text-slate-500">{roleLabel[selected.contact.role]}</div>}
                </div>
              </header>

              <div className="max-h-[60vh] flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
                {threadLoading && (
                  <div className="flex justify-center py-8 text-blue-600">
                    <Spinner />
                  </div>
                )}
                {threadError !== undefined && <Alert>{threadError}</Alert>}
                {thread?.hasMore === true && (
                  <div className="text-center">
                    <Button variant="secondary" onClick={() => void loadEarlier()} loading={loadingEarlier}>
                      Load earlier messages
                    </Button>
                  </div>
                )}
                {thread !== undefined && !threadLoading && thread.messages.length === 0 && threadPending.length === 0 && (
                  <p className="py-8 text-center text-sm text-slate-500">No messages yet. Say hello.</p>
                )}
                {thread?.messages.map((message) => (
                  <MessageBubble key={message.id} mine={message.senderId === me.id} body={message.body} meta={formatDate(message.createdAt)} />
                ))}
                {threadPending.map((item) => (
                  <MessageBubble
                    key={item.clientId}
                    mine
                    body={item.body}
                    meta={item.failed ?? "Sending…"}
                    failed={item.failed !== undefined}
                    onRetry={item.failed !== undefined ? () => retry(item) : undefined}
                  />
                ))}
                <div ref={bottomRef} />
              </div>

              <form onSubmit={submit} className="border-t border-slate-100 p-3">
                {selected !== undefined && selected.contact.status !== "ACTIVE" ? (
                  <p className="text-sm text-slate-500">This account is deactivated. You can read the history but not send new messages.</p>
                ) : (
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label htmlFor="chat-message" className="sr-only">
                        Message
                      </label>
                      <textarea
                        id="chat-message"
                        rows={2}
                        value={draft}
                        maxLength={CHAT_MESSAGE_MAX_LENGTH}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={onKeyDown}
                        disabled={!canSend || thread === undefined}
                        placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
                        className="block w-full resize-y rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:bg-slate-100"
                      />
                      <div className="mt-1 text-right text-xs text-slate-400">
                        {draft.length}/{CHAT_MESSAGE_MAX_LENGTH}
                      </div>
                    </div>
                    <Button type="submit" disabled={!canSend || thread === undefined || draft.trim() === ""} className="mb-5">
                      Send
                    </Button>
                  </div>
                )}
              </form>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageBubble({ mine, body, meta, failed = false, onRetry }: { mine: boolean; body: string; meta: string; failed?: boolean; onRetry?: (() => void) | undefined }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[85%] sm:max-w-[70%]">
        {/* Plain text only: React escapes it; never rendered as HTML. */}
        <div
          className={`whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
            mine ? (failed ? "bg-red-50 text-red-900 ring-1 ring-red-200" : "bg-blue-600 text-white") : "bg-slate-100 text-slate-900"
          }`}
        >
          {body}
        </div>
        <div className={`mt-1 flex items-center gap-2 text-xs ${mine ? "justify-end" : ""} ${failed ? "text-red-600" : "text-slate-400"}`}>
          <span>{meta}</span>
          {onRetry !== undefined && (
            <button type="button" className="font-medium underline" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
