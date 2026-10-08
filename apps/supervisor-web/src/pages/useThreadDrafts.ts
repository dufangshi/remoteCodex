import { useCallback, useRef, useState, type SetStateAction } from 'react';
import type { PromptAttachmentUpload } from '../lib/api';
interface Draft {
  prompt: string;
  attachments: PromptAttachmentUpload[];
}
const empty: Draft = { prompt: '', attachments: [] };
/** Drafts survive primary/reference swaps in this mounted workbench. They never enter layout storage. */
export function useThreadDrafts(source: string) {
  const active = useRef({ source });
  const owners = useRef<Record<string, object>>({ [source]: active.current });
  if (active.current.source !== source) {
    active.current = { source };
    owners.current[source] = active.current;
  }
  const owner = active.current;
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const update = useCallback(
    (action: SetStateAction<Draft>) => {
      if (owners.current[source] !== owner) return;
      setDrafts((current) => {
        if (owners.current[source] !== owner) return current;
        return {
          ...current,
          [source]:
            typeof action === 'function'
              ? action(current[source] ?? empty)
              : action,
        };
      });
    },
    [source, owner],
  );
  return [drafts[source] ?? empty, update] as const;
}
