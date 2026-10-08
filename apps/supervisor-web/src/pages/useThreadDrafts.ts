import { useCallback, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react';
import type { PromptAttachmentUpload } from '../lib/api';
interface Draft {
  prompt: string;
  attachments: PromptAttachmentUpload[];
}
const empty: Draft = { prompt: '', attachments: [] };
function useDraftBinding(
  key: string,
  drafts: Record<string, Draft>,
  setDrafts: Dispatch<SetStateAction<Record<string, Draft>>>,
  owners: MutableRefObject<Record<string, object>>,
) {
  const active = useRef<{ key: string; owner: object } | null>(null);
  if (!active.current || active.current.key !== key) {
    active.current = { key, owner: {} };
    owners.current[key] = active.current.owner;
  }
  const owner = active.current.owner;
  const update = useCallback((action: SetStateAction<Draft>) => {
    if (owners.current[key] !== owner) return;
    setDrafts(current => {
      if (owners.current[key] !== owner) return current;
      return { ...current, [key]: typeof action === 'function' ? action(current[key] ?? empty) : action };
    });
  }, [key, owner, owners, setDrafts]);
  return [drafts[key] ?? empty, update] as const;
}
/** Both pane bindings share a workbench-owned store, including across primary swaps.
 * Draft bodies and File objects stay in memory, never in layout storage. */
export function useThreadDrafts(source: string, secondarySource = '') {
  const owners = useRef<Record<string, object>>({});
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const primary = useDraftBinding(source, drafts, setDrafts, owners);
  const secondary = useDraftBinding(secondarySource, drafts, setDrafts, owners);
  return [...primary, ...secondary] as const;
}
