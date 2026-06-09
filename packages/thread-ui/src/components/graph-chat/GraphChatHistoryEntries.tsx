import type { ReactNode } from 'react';

export type GraphChatHistoryEntry =
  | {
      kind: 'item';
      key: string;
      item: unknown;
    }
  | {
      kind: 'commandGroup';
      key: string;
      items: unknown[];
    }
  | {
      kind: 'fileChangeGroup';
      key: string;
      items: unknown[];
    }
  | {
      kind: 'searchGroup';
      key: string;
      items: unknown[];
    }
  | {
      kind: 'fileReadGroup';
      key: string;
      items: unknown[];
    };

export interface GraphChatHistoryEntriesProps<
  TEntry extends GraphChatHistoryEntry = GraphChatHistoryEntry,
> {
  entries: TEntry[];
  expandedGroups: Record<string, boolean>;
  onToggleGroupedItem: (groupKey: string) => void;
  renderCommandGroup: (
    entry: Extract<TEntry, { kind: 'commandGroup' }>,
    expanded: boolean,
    onToggleExpanded: () => void,
  ) => ReactNode;
  renderFileChangeGroup: (
    entry: Extract<TEntry, { kind: 'fileChangeGroup' }>,
    expanded: boolean,
    onToggleExpanded: () => void,
  ) => ReactNode;
  renderFileReadGroup: (
    entry: Extract<TEntry, { kind: 'fileReadGroup' }>,
    expanded: boolean,
    onToggleExpanded: () => void,
  ) => ReactNode;
  renderItem: (entry: Extract<TEntry, { kind: 'item' }>) => ReactNode;
  renderSearchGroup: (
    entry: Extract<TEntry, { kind: 'searchGroup' }>,
    expanded: boolean,
    onToggleExpanded: () => void,
  ) => ReactNode;
}

export function GraphChatHistoryEntries<
  TEntry extends GraphChatHistoryEntry = GraphChatHistoryEntry,
>({
  entries,
  expandedGroups,
  onToggleGroupedItem,
  renderCommandGroup,
  renderFileChangeGroup,
  renderFileReadGroup,
  renderItem,
  renderSearchGroup,
}: GraphChatHistoryEntriesProps<TEntry>) {
  return (
    <>
      {entries.map((entry) => {
        const expanded = expandedGroups[entry.key] ?? false;
        const onToggleExpanded = () => onToggleGroupedItem(entry.key);

        if (entry.kind === 'commandGroup') {
          return renderCommandGroup(
            entry as Extract<TEntry, { kind: 'commandGroup' }>,
            expanded,
            onToggleExpanded,
          );
        }

        if (entry.kind === 'fileChangeGroup') {
          return renderFileChangeGroup(
            entry as Extract<TEntry, { kind: 'fileChangeGroup' }>,
            expanded,
            onToggleExpanded,
          );
        }

        if (entry.kind === 'searchGroup') {
          return renderSearchGroup(
            entry as Extract<TEntry, { kind: 'searchGroup' }>,
            expanded,
            onToggleExpanded,
          );
        }

        if (entry.kind === 'fileReadGroup') {
          return renderFileReadGroup(
            entry as Extract<TEntry, { kind: 'fileReadGroup' }>,
            expanded,
            onToggleExpanded,
          );
        }

        return renderItem(entry as Extract<TEntry, { kind: 'item' }>);
      })}
    </>
  );
}
