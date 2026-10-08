import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  ApiError, fetchThreadConversationPage, fetchThreadTurnDetail, searchThreadMessages,
  type ConversationSearchMatch, type ConversationSearchResult,
} from '../lib/api';
import type { ThreadTurnDto } from '@remote-codex/shared';

function matchMessages(turns: ThreadTurnDto[], query: string): ConversationSearchMatch[] {
  return turns.flatMap(turn => turn.items
    .filter(item => (item.kind === 'userMessage' || item.kind === 'agentMessage')
      && item.text.toLowerCase().includes(query))
    .map(item => ({ turnId: turn.id, itemId: item.id,
      role: item.kind === 'userMessage' ? 'You' : 'Assistant', text: item.text })));
}
const matchKey = (match: ConversationSearchMatch) => `${match.turnId}:${match.itemId}`;

export function ConversationSearch({ threadId, turns, open, onOpen, onClose, onSelect }: {
  threadId: string;
  turns: ThreadTurnDto[];
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSelect: (turns: ThreadTurnDto[], turnId: string, itemId: string) => void;
}) {
  useI18n();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const listId = useId();
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const [remote, setRemote] = useState<{ query: string; result: ConversationSearchResult } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [error, setError] = useState('');
  const [active, setActive] = useState(0);
  const legacy = useRef(false);
  const cache = useRef(new Map<string, { result: ConversationSearchResult; at: number }>());
  const selection = useRef<AbortController | null>(null);
  useEffect(() => () => selection.current?.abort(), []);
  useEffect(() => {
    if (!open) {
      selection.current?.abort(); setSelecting(false);
      if (restoreFocus.current) { trigger.current?.focus(); restoreFocus.current = false; }
      return;
    }
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) closeCallback.current();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  useEffect(() => {
    setActive(0);
    setError('');
    if (!open || !normalized) { setLoading(false); return; }
    const cached = cache.current.get(normalized);
    if (cached && Date.now() - cached.at < 30_000) {
      setRemote({ query: normalized, result: cached.result });
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        let result: ConversationSearchResult | undefined;
        if (!legacy.current) {
          try { result = await searchThreadMessages(threadId, normalized, controller.signal); }
          catch (e) {
            if (controller.signal.aborted) return;
            if (e instanceof ApiError && e.statusCode === 404) legacy.current = true;
            else throw e;
          }
        }
        if (!result) {
          const seen = new Set<string>();
          const matches: ConversationSearchMatch[] = [];
          let before: string | undefined;
          do {
            if (controller.signal.aborted) return;
            const page = await fetchThreadConversationPage(threadId, before, controller.signal);
            if (controller.signal.aborted) return;
            const fresh = page.turns.filter(turn => !seen.has(turn.id));
            if (!fresh.length) break;
            fresh.forEach(turn => seen.add(turn.id));
            matches.push(...matchMessages([...fresh].reverse(), normalized));
            setRemote({ query: normalized, result: { matches: matches.slice(0, 50), hasMore: matches.length > 50 } });
            before = fresh[0]?.id;
            if (matches.length > 50 || seen.size >= (page.totalTurnCount ?? seen.size)) break;
          } while (before);
          result = { matches: matches.slice(0, 50), hasMore: matches.length > 50 };
        }
        if (controller.signal.aborted) return;
        // Bound retained searches; cache is scoped to this mounted thread only.
        if (cache.current.size >= 10) cache.current.delete(cache.current.keys().next().value!);
        cache.current.set(normalized, { result, at: Date.now() });
        setRemote({ query: normalized, result });
      } catch (e) {
        if (!controller.signal.aborted) setError(e instanceof Error ? e.message : translate("chat.conversationSearch_searchFailed"));
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, normalized, threadId]);

  const matches = useMemo(() => {
    if (!normalized) return [];
    const merged = new Map<string, ConversationSearchMatch>();
    if (remote?.query === normalized) remote.result.matches.forEach(match => merged.set(matchKey(match), match));
    // The current live conversation is immediately searchable, even offline.
    matchMessages([...turns].reverse(), normalized).forEach(match => merged.set(matchKey(match), match));
    return [...merged.values()].slice(0, 50);
  }, [normalized, remote, turns]);
  const close = () => { restoreFocus.current = true; onClose(); };
  const select = async (match: ConversationSearchMatch) => {
    if (selecting) return;
    selection.current?.abort();
    const controller = new AbortController();
    selection.current = controller;
    setSelecting(true); setError('');
    try {
      const loaded = turns.find(turn => turn.id === match.turnId && !turn.hasDeferredItems);
      const turn = loaded ?? await fetchThreadTurnDetail(threadId, match.turnId);
      if (controller.signal.aborted) return;
      onSelect([turn], match.turnId, match.itemId);
      close();
    } catch (e) {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : translate("chat.conversationSearch_couldNotOpenThisMessage"));
    } finally { if (!controller.signal.aborted) setSelecting(false); }
  };

  return <div ref={root} className={`workbench-search ${open ? 'is-open' : ''}`}>
    {!open ? <button ref={trigger} className="matter-search-trigger" aria-label={translate("chat.conversationSearch_searchConversation")} onClick={onOpen}>
      <Search /><span>{translate("chat.conversationSearch_searchConversation")}</span>
    </button> : <>
      <div className="workbench-search-field">
        <Search size={16} aria-hidden="true" />
        <input ref={input} role="combobox" aria-label={translate("chat.conversationSearch_searchMessages")} placeholder={translate("chat.conversationSearch_searchConversation_b2cb99")}
          aria-autocomplete="list" aria-expanded={!!normalized} aria-controls={normalized ? listId : undefined}
          aria-activedescendant={normalized && matches[active] ? `${listId}-${active}` : undefined}
          value={query} maxLength={200} onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); }
            if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length) {
              event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : matches.length - 1)) % matches.length);
            }
            if (event.key === 'Enter' && matches[active] && !event.nativeEvent.isComposing) {
              event.preventDefault(); void select(matches[active]);
            }
          }} />
        <button type="button" aria-label={translate("chat.conversationSearch_closeSearch")} onClick={close}><X size={16} /></button>
      </div>
      {(normalized || error) && <div className="workbench-search-dropdown" aria-label={translate("chat.conversationSearch_conversationSearchResults")}>
        <p role="status">{selecting ? translate("chat.conversationSearch_openingMessage") : loading
          ? translate("chat.conversationSearch_searchingOlderMessages", { value1: matches.length ? translate("chat.matches", { value1: matches.length }) : '' })
          : translate("chat.conversationSearch_matchingMessages", { value1: matches.length, value2: remote?.query === normalized && remote.result.hasMore ? '+' : '' })}</p>
        {error && <p role="alert">{error}</p>}
        <div id={listId} className="workbench-search-results" role="listbox" aria-label={translate("chat.conversationSearch_matchingMessages_f5412f")}>
          {matches.map((match, index) => {
            const found = match.text.toLowerCase().indexOf(normalized);
            const start = Math.max(0, found - 80);
            const finish = found + normalized.length;
            return <button key={matchKey(match)} id={`${listId}-${index}`} type="button" role="option"
              aria-selected={index === active} disabled={selecting}
              onMouseEnter={() => setActive(index)} onMouseDown={event => event.preventDefault()}
              onClick={() => void select(match)}>
              <strong>{match.role === 'You' || match.role === 'user' ? translate('chat.searchUserRole') : match.role === 'Assistant' || match.role === 'assistant' ? translate('chat.searchAssistantRole') : match.role}</strong><p>{start > 0 ? '…' : ''}{match.text.slice(start, found)}
                <mark>{match.text.slice(found, finish)}</mark>{match.text.slice(finish, finish + 180)}
                {match.text.length > finish + 180 ? '…' : ''}</p>
            </button>;
          })}
        </div>
        {!loading && !error && !matches.length && <p>{translate("chat.conversationSearch_noMatchingMessages")}</p>}
        {remote?.query === normalized && remote.result.hasMore && <p>{translate("chat.conversationSearch_showingTheFirst50MatchesRefineYour")}</p>}
      </div>}
    </>}
  </div>;
}
