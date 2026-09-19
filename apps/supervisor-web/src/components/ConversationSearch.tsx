import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { fetchThreadDetail } from '../lib/api';

export function ConversationSearch({
  threadId,
  onClose,
}: {
  threadId: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [messages, setMessages] = useState<
    { id: string; role: string; text: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    dialog.current?.showModal();
    async function load() {
      let beforeTurnId: string | undefined;
      const seen = new Set<string>();
      const next: typeof messages = [];
      do {
        const page = await fetchThreadDetail(threadId, {
          limit: 100,
          ...(beforeTurnId ? { beforeTurnId } : {}),
        });
        if (!alive) return;
        const fresh = page.turns.filter((t) => !seen.has(t.id));
        if (!fresh.length) break;
        fresh.forEach((t) => {
          seen.add(t.id);
          t.items
            .filter(
              (i) => i.kind === 'userMessage' || i.kind === 'agentMessage',
            )
            .forEach((i) =>
              next.push({
                id: `${t.id}:${i.id}`,
                role: i.kind === 'userMessage' ? 'You' : 'Assistant',
                text: i.text,
              }),
            );
        });
        beforeTurnId = fresh[0]?.id;
        setMessages([...next]);
        if (seen.size >= (page.totalTurnCount ?? seen.size)) break;
      } while (beforeTurnId);
    }
    void load()
      .catch((e) => {
        if (alive)
          setError(
            e instanceof Error ? e.message : 'Search could not load history.',
          );
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [threadId]);
  const normalized = query.trim().toLocaleLowerCase();
  const matches = normalized
    ? messages.filter((m) => m.text.toLocaleLowerCase().includes(normalized))
    : [];
  return (
    <dialog
      ref={dialog}
      className="workbench-search"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      aria-labelledby="conversation-search-title"
    >
      <div className="workbench-search-header">
        <Search size={18} />
        <h2 id="conversation-search-title">Search conversation</h2>
        <button aria-label="Close search" onClick={onClose}>
          <X size={18} />
        </button>
      </div>
      <input
        autoFocus
        aria-label="Search messages"
        placeholder="Find something in this conversation…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <p role="status">
        {loading
          ? 'Loading conversation history…'
          : normalized
            ? `${matches.length} matching messages`
            : 'Search prompts and replies across this thread.'}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="workbench-search-results">
        {matches.slice(0, 100).map((m) => {
          const index = m.text.toLocaleLowerCase().indexOf(normalized);
          const start = Math.max(0, index - 120);
          return (
            <article key={m.id}>
              <strong>{m.role}</strong>
              <p>
                {start > 0 ? '…' : ''}
                {m.text.slice(start, index)}
                <mark>{m.text.slice(index, index + query.trim().length)}</mark>
                {m.text.slice(index + query.trim().length, index + 360)}
                {m.text.length > index + 360 ? '…' : ''}
              </p>
            </article>
          );
        })}
        {matches.length > 100 && (
          <p>
            Showing the first 100 matches. Refine your search to narrow the
            results.
          </p>
        )}
      </div>
    </dialog>
  );
}
