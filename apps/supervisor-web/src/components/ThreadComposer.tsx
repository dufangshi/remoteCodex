import {
  ClipboardEvent,
  type Dispatch,
  DragEvent,
  FormEvent,
  KeyboardEvent,
  useLayoutEffect,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  CollaborationModeDto,
  ModelOptionDto,
  PromptAttachmentKindDto,
  ThreadContextUsageDto,
  ReasoningEffortDto,
  UpdateThreadSettingsInput,
} from '../../../../packages/shared/src/index';
import type { ThreadShellControlState } from './ThreadShellPanel';
import type { PromptAttachmentUpload } from '../lib/api';

interface ThreadComposerProps {
  activeView: 'chat' | 'shell';
  edgeToEdgeMobile?: boolean;
  busy?: boolean;
  settingsBusy?: boolean;
  error?: string | null;
  model?: string | null;
  reasoningEffort?: ReasoningEffortDto | null;
  collaborationMode?: CollaborationModeDto;
  modelOptions?: ModelOptionDto[];
  contextUsage?: ThreadContextUsageDto | null | undefined;
  followTail?: boolean;
  threadConnected?: boolean;
  disabled?: boolean;
  disabledPlaceholder?: string | undefined;
  shellControlState?: ThreadShellControlState | null;
  draftPrompt?: string | undefined;
  draftAttachments?: PromptAttachmentUpload[] | undefined;
  onDraftChange?: Dispatch<
    SetStateAction<{
      prompt: string;
      attachments: PromptAttachmentUpload[];
    }>
  > | undefined;
  onSubmit: (input: {
    prompt: string;
    attachments?: PromptAttachmentUpload[];
  }) => Promise<void> | void;
  onInterrupt?: () => Promise<void> | void;
  onToggleFollow?: () => void;
  onUpdateSettings?: (input: UpdateThreadSettingsInput) => Promise<void> | void;
  onToggleView?: () => void;
  onShellCopy?: () => Promise<void> | void;
  onShellControl?: (
    action: 'ctrl_c' | 'ctrl_d' | 'esc' | 'tab' | 'up' | 'down' | 'clear',
  ) => Promise<void> | void;
  canInterrupt?: boolean;
}

type SettingsMenu = 'attachments' | 'model' | 'effort' | 'shellTools' | null;

interface ComposerAttachmentDraft extends PromptAttachmentUpload {}

interface PromptTextSegment {
  type: 'text';
  key: string;
  text: string;
}

interface PromptAttachmentSegment {
  type: 'attachment';
  key: string;
  attachment: ComposerAttachmentDraft;
}

type PromptSegment = PromptTextSegment | PromptAttachmentSegment;
type AttachmentPreviewMap = Record<string, string>;

function normalizePromptText(value: string) {
  return value.replace(/\u00a0/g, ' ');
}

function tokenizePrompt(
  prompt: string,
  attachments: ComposerAttachmentDraft[],
): PromptSegment[] {
  if (!prompt) {
    return [];
  }

  const segments: PromptSegment[] = [];
  const placeholders = [...attachments].sort(
    (left, right) => right.placeholder.length - left.placeholder.length,
  );
  let cursor = 0;
  let textIndex = 0;

  while (cursor < prompt.length) {
    const matchingAttachment = placeholders.find((attachment) =>
      prompt.startsWith(attachment.placeholder, cursor),
    );

    if (matchingAttachment) {
      segments.push({
        type: 'attachment',
        key: `${matchingAttachment.clientId}-${cursor}`,
        attachment: matchingAttachment,
      });
      cursor += matchingAttachment.placeholder.length;
      continue;
    }

    let nextTokenIndex = prompt.length;
    for (const attachment of placeholders) {
      const candidateIndex = prompt.indexOf(attachment.placeholder, cursor);
      if (candidateIndex !== -1 && candidateIndex < nextTokenIndex) {
        nextTokenIndex = candidateIndex;
      }
    }

    const text = prompt.slice(cursor, nextTokenIndex);
    if (text) {
      segments.push({
        type: 'text',
        key: `text-${textIndex}`,
        text,
      });
      textIndex += 1;
    }
    cursor = nextTokenIndex;
  }

  return segments;
}

function formatReasoningEffortLabel(value: ReasoningEffortDto | null | undefined) {
  if (!value) {
    return 'Auto';
  }

  switch (value) {
    case 'xhigh':
      return 'xhigh';
    default:
      return value;
  }
}

function TerminalIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m4 5 2 2-2 2" />
      <path d="M7.75 9.5h4.25" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.5"
      strokeLinecap="round"
    >
      <path d="M8 3.25v9.5M3.25 8h9.5" />
    </svg>
  );
}

function clampPercent(value: number | null | undefined) {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function ContextRingFrame({
  contextUsage,
}: {
  contextUsage: ThreadContextUsageDto | null | undefined;
}) {
  const availability = contextUsage?.availability ?? 'unavailable';
  const percent = clampPercent(contextUsage?.remainingPercent);
  const progressPercent = availability === 'available' ? percent : 100;
  const progressStroke =
    availability !== 'available'
      ? 'rgba(120,113,108,0.55)'
      : percent <= 20
        ? 'rgba(251,113,133,0.95)'
        : percent <= 40
          ? 'rgba(252,211,77,0.94)'
          : 'rgba(125,211,252,0.95)';

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <rect
        x="1"
        y="1"
        width="98"
        height="30"
        rx="15"
        pathLength="100"
        fill="none"
        stroke="rgba(41,37,36,0.92)"
        strokeWidth="1.5"
      />
      <rect
        x="1"
        y="1"
        width="98"
        height="30"
        rx="15"
        pathLength="100"
        fill="none"
        stroke={progressStroke}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeDasharray={`${progressPercent} 100`}
      />
    </svg>
  );
}

function normalizedAttachmentFileName(file: File, kind: PromptAttachmentKindDto) {
  const trimmed = file.name.trim();
  if (trimmed) {
    return trimmed;
  }

  const fallbackExtension =
    kind === 'photo'
      ? file.type.includes('png')
        ? '.png'
        : file.type.includes('heic')
          ? '.heic'
          : file.type.includes('heif')
            ? '.heif'
            : file.type.includes('webp')
              ? '.webp'
              : '.jpg'
      : '';
  return `${kind === 'photo' ? 'photo' : 'file'}-${Date.now()}${fallbackExtension}`;
}

function normalizeAttachmentLabel(name: string) {
  const sanitized = name.replace(/[\r\n[\]]+/g, ' ').replace(/\s+/g, ' ').trim();
  return sanitized || 'attachment';
}

function classifyAttachmentKind(file: File): PromptAttachmentKindDto {
  return file.type.startsWith('image/') ? 'photo' : 'file';
}

function extractFilesFromTransfer(
  items: DataTransferItemList | null | undefined,
  files: FileList | null | undefined,
) {
  const extractedFiles: File[] = [];

  if (items) {
    for (const item of Array.from(items)) {
      if (item.kind !== 'file') {
        continue;
      }
      const file = item.getAsFile();
      if (file) {
        extractedFiles.push(file);
      }
    }
  }

  if (extractedFiles.length > 0) {
    return extractedFiles;
  }

  if (files) {
    return Array.from(files);
  }

  return [];
}

function hasTransferFiles(
  items: DataTransferItemList | null | undefined,
  files: FileList | null | undefined,
) {
  return extractFilesFromTransfer(items, files).length > 0;
}

function segmentNodeText(child: ChildNode) {
  if (
    child instanceof HTMLElement &&
    child.dataset.segmentType === 'attachment' &&
    child.dataset.placeholder
  ) {
    return child.dataset.placeholder;
  }

  return child.textContent ?? '';
}

function basenameFromAttachmentPath(value: string) {
  const normalized = value.replace(/[\\/]+$/, '').trim();
  if (!normalized) {
    return '';
  }
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? normalized;
}

function attachmentDisplayLabel(attachment: ComposerAttachmentDraft) {
  const placeholderMatch = attachment.placeholder.match(/^\[(?:PHOTO|FILE)\s+(.+)\]$/);
  if (placeholderMatch?.[1]) {
    return placeholderMatch[1];
  }

  return basenameFromAttachmentPath(attachment.originalName);
}

function ChatIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 4.5A1.75 1.75 0 0 1 4.75 2.75h6.5A1.75 1.75 0 0 1 13 4.5v4A1.75 1.75 0 0 1 11.25 10.25H8l-2.75 2v-2H4.75A1.75 1.75 0 0 1 3 8.5v-4Z" />
    </svg>
  );
}

function WrenchScrewdriverIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      className="h-3.5 w-3.5 fill-current"
    >
      <path
        fillRule="evenodd"
        d="M14.5 10C16.9853 10 19 7.98528 19 5.5C19 5.01783 18.9242 4.55338 18.7838 4.11791C18.6792 3.79367 18.2734 3.72683 18.0325 3.96772L15.3402 6.66002C15.2098 6.79041 15.0168 6.84163 14.8466 6.77074C14.1172 6.46695 13.5334 5.88351 13.2292 5.15431C13.1582 4.98403 13.2094 4.79088 13.3398 4.66042L16.0327 1.9676C16.2735 1.72672 16.2067 1.32092 15.8825 1.21636C15.4469 1.07588 14.9823 1 14.5 1C12.0147 1 10 3.01472 10 5.5C10 5.59783 10.0031 5.69494 10.0093 5.79122C10.065 6.66418 9.88174 7.59855 9.20974 8.15855L1.98017 14.1832C1.3591 14.7008 1 15.4674 1 16.2759C1 17.7804 2.21962 19 3.7241 19C4.53256 19 5.29925 18.6409 5.81681 18.0198L11.8414 10.7903C12.4014 10.1183 13.3358 9.93497 14.2088 9.99073C14.3051 9.99688 14.4022 10 14.5 10ZM5 16C5 16.5523 4.55228 17 4 17C3.44772 17 3 16.5523 3 16C3 15.4477 3.44772 15 4 15C4.55228 15 5 15.4477 5 16Z"
        clipRule="evenodd"
      />
      <path d="M14.5 11.5C14.6731 11.5 14.8445 11.4927 15.0138 11.4783L18.7678 15.2323C19.7441 16.2086 19.7441 17.7915 18.7678 18.7678C17.7915 19.7441 16.2086 19.7441 15.2323 18.7678L10.8216 14.3571L12.9938 11.7505C13.0455 11.6885 13.1413 11.6131 13.3357 11.5552C13.5378 11.4951 13.805 11.468 14.1132 11.4877C14.2413 11.4959 14.3702 11.5 14.5 11.5Z" />
      <path d="M6.00003 4.58582L8.33056 6.91635C8.3027 6.95627 8.27496 6.98497 8.24946 7.00622L6.79994 8.21415L4.58582 6.00003H3.30905C3.11966 6.00003 2.94653 5.89303 2.86184 5.72364L1.1612 2.32237C1.06495 2.12987 1.10268 1.89739 1.25486 1.74521L1.74521 1.25486C1.89739 1.10268 2.12987 1.06495 2.32237 1.1612L5.72364 2.86184C5.89303 2.94653 6.00003 3.11966 6.00003 3.30905V4.58582Z" />
    </svg>
  );
}

function ClipboardIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 fill-none stroke-current"
      strokeWidth="1.35"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M5.5 3.25h5" />
      <path d="M6.4 2h3.2a.9.9 0 0 1 .9.9v.35h1.3a1.2 1.2 0 0 1 1.2 1.2v7.35a1.2 1.2 0 0 1-1.2 1.2H4.2A1.2 1.2 0 0 1 3 11.8V4.45a1.2 1.2 0 0 1 1.2-1.2h1.3V2.9a.9.9 0 0 1 .9-.9Z" />
    </svg>
  );
}

function ToolPill({
  label,
  tone = 'stone',
}: {
  label: string;
  tone?: 'stone' | 'rose' | 'sky';
}) {
  const toneClassName =
    tone === 'rose'
      ? 'border-rose-300/35 bg-rose-300/14 text-rose-50'
      : tone === 'sky'
        ? 'border-sky-300/35 bg-sky-300/14 text-sky-50'
        : 'border-stone-700/90 bg-stone-900/80 text-stone-100';

  return (
    <span
      className={`inline-flex min-w-[3rem] items-center justify-center rounded-full border px-2 py-1.5 text-[10px] font-medium tracking-[0.12em] ${toneClassName}`}
    >
      {label}
    </span>
  );
}

export function ThreadComposer({
  activeView,
  edgeToEdgeMobile = false,
  busy = false,
  settingsBusy = false,
  error,
  model = null,
  reasoningEffort = null,
  collaborationMode = 'default',
  modelOptions = [],
  contextUsage = null,
  followTail = false,
  threadConnected = true,
  disabled = false,
  disabledPlaceholder,
  shellControlState = null,
  draftPrompt,
  draftAttachments,
  onDraftChange,
  onSubmit,
  onInterrupt,
  onToggleFollow,
  onUpdateSettings,
  onToggleView,
  onShellCopy,
  onShellControl,
  canInterrupt = false,
}: ThreadComposerProps) {
  const [internalDraft, setInternalDraft] = useState<{
    prompt: string;
    attachments: ComposerAttachmentDraft[];
  }>({
    prompt: '',
    attachments: [],
  });
  const [openMenu, setOpenMenu] = useState<SettingsMenu>(null);
  const menuRef = useRef<HTMLFormElement | null>(null);
  const promptRef = useRef<HTMLDivElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingSelectionRef = useRef<{ start: number; end: number } | null>(null);
  const pendingInsertedAttachmentIdsRef = useRef<string[]>([]);
  const selectionSnapshotRef = useRef<{ start: number; end: number } | null>(null);
  const previewUrlCacheRef = useRef<Map<string, string>>(new Map());
  const renderedPreviewSignatureRef = useRef('');
  const isShellView = activeView === 'shell';
  const isMobileShell = Boolean(isShellView && shellControlState?.isMobileShell);
  const shellPromptLabel = shellControlState?.promptLabel ?? null;
  const [attachmentPreviewUrls, setAttachmentPreviewUrls] = useState<AttachmentPreviewMap>({});
  const [isDragTargetActive, setIsDragTargetActive] = useState(false);
  const isDraftControlled =
    !isShellView &&
    draftPrompt !== undefined &&
    draftAttachments !== undefined &&
    typeof onDraftChange === 'function';
  const prompt = isDraftControlled ? draftPrompt : internalDraft.prompt;
  const attachments = (isDraftControlled
    ? draftAttachments
    : internalDraft.attachments) as ComposerAttachmentDraft[];

  function updateDraft(
    updater: (current: {
      prompt: string;
      attachments: ComposerAttachmentDraft[];
    }) => {
      prompt: string;
      attachments: ComposerAttachmentDraft[];
    },
  ) {
    if (isDraftControlled) {
      onDraftChange?.((current) =>
        updater({
          prompt: current.prompt,
          attachments: current.attachments as ComposerAttachmentDraft[],
        }),
      );
      return;
    }

    setInternalDraft((current) => updater(current));
  }

  function setPrompt(
    next:
      | string
      | ((
          current: string,
          attachments: ComposerAttachmentDraft[],
        ) => {
          prompt: string;
          attachments?: ComposerAttachmentDraft[];
        }),
  ) {
    updateDraft((current) => {
      if (typeof next === 'function') {
        const resolved = next(current.prompt, current.attachments);
        return {
          prompt: resolved.prompt,
          attachments: resolved.attachments ?? current.attachments,
        };
      }

      return {
        prompt: next,
        attachments: current.attachments,
      };
    });
  }

  function setAttachments(
    next:
      | ComposerAttachmentDraft[]
      | ((current: ComposerAttachmentDraft[]) => {
          attachments: ComposerAttachmentDraft[];
          prompt?: string;
        }),
  ) {
    updateDraft((current) => {
      if (typeof next === 'function') {
        const resolved = next(current.attachments);
        return {
          prompt: resolved.prompt ?? current.prompt,
          attachments: resolved.attachments,
        };
      }

      return {
        prompt: current.prompt,
        attachments: next,
      };
    });
  }

  const currentModel = useMemo(
    () => modelOptions.find((entry) => entry.model === model) ?? null,
    [model, modelOptions],
  );
  const modelContextTitle =
    model && contextUsage?.availability === 'available'
      ? `${model} · ${clampPercent(contextUsage.remainingPercent)}% context left`
      : model
        ? `${model} · context unavailable`
        : 'Select model';
  const supportedEfforts = currentModel?.supportedReasoningEfforts ?? [];
  const promptSegments = useMemo(
    () => tokenizePrompt(prompt, attachments),
    [attachments, prompt],
  );
  const previewSignature = useMemo(
    () =>
      Object.entries(attachmentPreviewUrls)
        .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
        .map(([clientId, previewUrl]) => `${clientId}:${previewUrl}`)
        .join('|'),
    [attachmentPreviewUrls],
  );

  useEffect(() => {
    if (isShellView) {
      setAttachmentPreviewUrls({});
      return;
    }

    const nextPreviewUrls: AttachmentPreviewMap = {};
    const activeClientIds = new Set<string>();

    for (const attachment of attachments) {
      if (attachment.kind !== 'photo') {
        continue;
      }

      activeClientIds.add(attachment.clientId);
      let previewUrl = previewUrlCacheRef.current.get(attachment.clientId);
      if (!previewUrl) {
        previewUrl = URL.createObjectURL(attachment.file);
        previewUrlCacheRef.current.set(attachment.clientId, previewUrl);
      }
      nextPreviewUrls[attachment.clientId] = previewUrl;
    }

    for (const [clientId, previewUrl] of previewUrlCacheRef.current.entries()) {
      if (activeClientIds.has(clientId)) {
        continue;
      }
      URL.revokeObjectURL(previewUrl);
      previewUrlCacheRef.current.delete(clientId);
    }

    setAttachmentPreviewUrls(nextPreviewUrls);
  }, [attachments, isShellView]);

  useEffect(() => {
    return () => {
      for (const previewUrl of previewUrlCacheRef.current.values()) {
        URL.revokeObjectURL(previewUrl);
      }
      previewUrlCacheRef.current.clear();
    };
  }, []);

  function snapshotSelection() {
    const editor = promptRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) {
      return null;
    }

    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return null;
    }

    return {
      start: measureSelectionOffset(editor, range.startContainer, range.startOffset),
      end: measureSelectionOffset(editor, range.endContainer, range.endOffset),
    };
  }

  function measureSelectionOffset(
    root: HTMLDivElement,
    container: Node,
    offset: number,
  ) {
    let resolvedChild: ChildNode | null = null;
    let offsetWithinChild = offset;

    if (container === root) {
      const childNodes = Array.from(root.childNodes);
      let total = 0;
      for (let index = 0; index < Math.min(offset, childNodes.length); index += 1) {
        const child = childNodes[index];
        if (child) {
          total += segmentNodeText(child).length;
        }
      }
      return total;
    }

    if (container.nodeType === Node.TEXT_NODE) {
      resolvedChild = container as ChildNode;
    } else {
      const nearestChild = Array.from(root.childNodes).find((child) => child.contains(container));
      if (!nearestChild) {
        return serializeEditorPrompt().length;
      }
      resolvedChild = nearestChild;

      if (
        nearestChild instanceof HTMLElement &&
        nearestChild.dataset.segmentType === 'attachment'
      ) {
        const range = document.createRange();
        range.selectNodeContents(nearestChild);
        const placeholderLength = segmentNodeText(nearestChild).length;
        try {
          range.setEnd(container, offset);
          const visibleOffset = range.toString().length;
          const attachmentTextLength = nearestChild.textContent?.length ?? 0;
          if (attachmentTextLength === 0) {
            offsetWithinChild = placeholderLength;
          } else {
            offsetWithinChild = Math.round(
              Math.min(1, visibleOffset / attachmentTextLength) * placeholderLength,
            );
          }
        } catch {
          offsetWithinChild = placeholderLength;
        }
      } else {
        const range = document.createRange();
        range.selectNodeContents(nearestChild);
        try {
          range.setEnd(container, offset);
          offsetWithinChild = range.toString().length;
        } catch {
          offsetWithinChild = segmentNodeText(nearestChild).length;
        }
      }
    }

    const childNodes = Array.from(root.childNodes);
    let total = 0;
    for (const child of childNodes) {
      if (child === resolvedChild) {
        if (child.nodeType === Node.TEXT_NODE) {
          return total + offsetWithinChild;
        }
        return total + Math.min(offsetWithinChild, segmentNodeText(child).length);
      }
      total += segmentNodeText(child).length;
    }

    return total;
  }

  function resolveOffsetToDomPosition(root: HTMLDivElement, targetOffset: number) {
    let remaining = Math.max(0, targetOffset);
    const childNodes = Array.from(root.childNodes);

    for (const [index, child] of childNodes.entries()) {
      const childText = segmentNodeText(child);
      const childLength = childText.length;

      if (child.nodeType === Node.TEXT_NODE) {
        if (remaining <= childLength) {
          return {
            node: child,
            offset: remaining,
          };
        }

        remaining -= childLength;
        continue;
      }

      if (
        child instanceof HTMLElement &&
        child.dataset.segmentType === 'attachment'
      ) {
        if (remaining === 0) {
          return {
            node: root,
            offset: index,
          };
        }

        if (remaining <= childLength) {
          const nextChild = childNodes[index + 1];
          if (remaining === childLength && nextChild?.nodeType === Node.TEXT_NODE) {
            return {
              node: nextChild,
              offset: 0,
            };
          }
          return {
            node: root,
            offset: index + 1,
          };
        }

        remaining -= childLength;
        continue;
      }

      if (remaining <= childLength) {
        return {
          node: root,
          offset: index + 1,
        };
      }

      remaining -= childLength;
    }

    return {
      node: root,
      offset: root.childNodes.length,
    };
  }

  function restoreSelection(selection: { start: number; end: number } | null) {
    const editor = promptRef.current;
    if (!editor || !selection) {
      return;
    }

    const startPosition = resolveOffsetToDomPosition(editor, selection.start);
    const endPosition = resolveOffsetToDomPosition(editor, selection.end);
    const range = document.createRange();
    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);

    const currentSelection = window.getSelection();
    currentSelection?.removeAllRanges();
    currentSelection?.addRange(range);
  }

  function restoreSelectionAfterInsertedAttachments(editor: HTMLDivElement) {
    const insertedClientIds = pendingInsertedAttachmentIdsRef.current;
    if (insertedClientIds.length === 0) {
      return false;
    }

    const lastInsertedClientId = insertedClientIds.at(-1);
    if (!lastInsertedClientId) {
      return false;
    }

    const attachmentNode = Array.from(editor.childNodes).find(
      (child) =>
        child instanceof HTMLElement &&
        child.dataset.segmentType === 'attachment' &&
        child.dataset.clientId === lastInsertedClientId,
    );

    if (!(attachmentNode instanceof HTMLElement)) {
      return false;
    }

    const range = document.createRange();
    const trailingNode = attachmentNode.nextSibling;
    if (trailingNode?.nodeType === Node.TEXT_NODE) {
      range.setStart(trailingNode, 0);
    } else {
      range.setStartAfter(attachmentNode);
    }
    range.collapse(true);

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }

  function serializeEditorPrompt() {
    const editor = promptRef.current;
    if (!editor) {
      return prompt;
    }

    let nextPrompt = '';
    for (const child of Array.from(editor.childNodes)) {
      nextPrompt += segmentNodeText(child);
    }

    return normalizePromptText(nextPrompt);
  }

  function buildAttachmentPlaceholder(
    kind: PromptAttachmentKindDto,
    name: string,
    usedPlaceholders: Set<string>,
  ) {
    const token = kind === 'photo' ? 'PHOTO' : 'FILE';
    let suffix = 0;

    while (true) {
      const label = suffix === 0 ? name : `${name} (${suffix + 1})`;
      const placeholder = `[${token} ${label}]`;
      if (!usedPlaceholders.has(placeholder)) {
        return placeholder;
      }
      suffix += 1;
    }
  }

  function buildClientId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }

    return `attachment-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function buildAttachmentInsertionText(
    basePrompt: string,
    insertionPoint: { start: number; end: number },
    placeholders: string[],
  ) {
    const beforeChar = insertionPoint.start > 0 ? basePrompt[insertionPoint.start - 1] : '';
    const afterChar =
      insertionPoint.end < basePrompt.length ? basePrompt[insertionPoint.end] : '';
    const needsLeadingSpace = Boolean(beforeChar && !/\s/.test(beforeChar));
    const needsTrailingSpace = !afterChar || !/\s/.test(afterChar);
    return `${needsLeadingSpace ? ' ' : ''}${placeholders.join(' ')}${needsTrailingSpace ? ' ' : ''}`;
  }

  function appendAttachments(
    files: FileList | null,
    kind: PromptAttachmentKindDto,
  ) {
    if (!files || files.length === 0) {
      return;
    }

    const nextFiles = Array.from(files);
    const usedPlaceholders = new Set<string>(attachments.map((entry) => entry.placeholder));
    const nextAttachments: ComposerAttachmentDraft[] = nextFiles.map((file) => {
      const originalName = normalizedAttachmentFileName(file, kind);
      const placeholder = buildAttachmentPlaceholder(
        kind,
        normalizeAttachmentLabel(originalName),
        usedPlaceholders,
      );
      usedPlaceholders.add(placeholder);
      return {
        clientId: buildClientId(),
        kind,
        originalName,
        placeholder,
        file
      };
    });

    const selection = snapshotSelection() ?? selectionSnapshotRef.current;
    const insertionPoint = selection
      ? {
          start: selection.start,
          end: selection.end,
        }
      : {
          start: prompt.length,
          end: prompt.length,
        };
    const insertionText = buildAttachmentInsertionText(
      prompt,
      insertionPoint,
      nextAttachments.map((entry) => entry.placeholder),
    );
    const nextPrompt = `${prompt.slice(0, insertionPoint.start)}${insertionText}${prompt.slice(
      insertionPoint.end,
    )}`;

    updateDraft((current) => ({
      prompt: nextPrompt,
      attachments: [...current.attachments, ...nextAttachments],
    }));
    const trailingSpacerOffset = insertionText.endsWith(' ') ? 1 : 0;
    const nextCaret = insertionPoint.start + insertionText.length - trailingSpacerOffset;
    pendingSelectionRef.current = {
      start: nextCaret,
      end: nextCaret,
    };
    selectionSnapshotRef.current = {
      start: nextCaret,
      end: nextCaret,
    };
    pendingInsertedAttachmentIdsRef.current = nextAttachments.map(
      (attachment) => attachment.clientId,
    );
    setOpenMenu(null);
  }

  function appendDroppedAttachments(files: File[]) {
    if (files.length === 0) {
      return;
    }

    const groupedFiles = {
      photo: files.filter((file) => classifyAttachmentKind(file) === 'photo'),
      file: files.filter((file) => classifyAttachmentKind(file) === 'file'),
    };

    const nextFiles = [...groupedFiles.photo, ...groupedFiles.file];
    const usedPlaceholders = new Set<string>(attachments.map((entry) => entry.placeholder));
    const nextAttachments: ComposerAttachmentDraft[] = nextFiles.map((file) => {
      const kind = classifyAttachmentKind(file);
      const originalName = normalizedAttachmentFileName(file, kind);
      const placeholder = buildAttachmentPlaceholder(
        kind,
        normalizeAttachmentLabel(originalName),
        usedPlaceholders,
      );
      usedPlaceholders.add(placeholder);
      return {
        clientId: buildClientId(),
        kind,
        originalName,
        placeholder,
        file,
      };
    });

    const selection = snapshotSelection() ?? selectionSnapshotRef.current;
    const insertionPoint = selection
      ? { start: selection.start, end: selection.end }
      : { start: prompt.length, end: prompt.length };
    const insertionText = buildAttachmentInsertionText(
      prompt,
      insertionPoint,
      nextAttachments.map((entry) => entry.placeholder),
    );
    const nextPrompt = `${prompt.slice(0, insertionPoint.start)}${insertionText}${prompt.slice(
      insertionPoint.end,
    )}`;

    updateDraft((current) => ({
      prompt: nextPrompt,
      attachments: [...current.attachments, ...nextAttachments],
    }));
    const trailingSpacerOffset = insertionText.endsWith(' ') ? 1 : 0;
    const nextCaret = insertionPoint.start + insertionText.length - trailingSpacerOffset;
    pendingSelectionRef.current = { start: nextCaret, end: nextCaret };
    selectionSnapshotRef.current = { start: nextCaret, end: nextCaret };
    pendingInsertedAttachmentIdsRef.current = nextAttachments.map(
      (attachment) => attachment.clientId,
    );
    setOpenMenu(null);
  }

  useEffect(() => {
    function handleWindowClick(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    if (openMenu) {
      window.addEventListener('click', handleWindowClick);
      return () => {
        window.removeEventListener('click', handleWindowClick);
      };
    }
  }, [openMenu]);

  useLayoutEffect(() => {
    const editor = promptRef.current;
    if (!editor || isShellView) {
      return;
    }

    const pendingSelection = pendingSelectionRef.current;
    const shouldSyncDom =
      serializeEditorPrompt() !== prompt ||
      renderedPreviewSignatureRef.current !== previewSignature;

    if (shouldSyncDom) {
      const fragment = document.createDocumentFragment();

      for (const segment of promptSegments) {
        if (segment.type === 'text') {
          fragment.append(
            document.createTextNode(segment.text === ' ' ? '\u00a0' : segment.text),
          );
          continue;
        }

        const attachment = segment.attachment;
        const token = document.createElement('span');
        token.dataset.segmentType = 'attachment';
        token.dataset.clientId = attachment.clientId;
        token.dataset.placeholder = attachment.placeholder;
        token.contentEditable = 'false';
        token.className = 'mx-[0.12rem] inline-flex max-w-full align-baseline';

        if (attachment.kind === 'photo') {
          token.classList.add('rounded-[0.95rem]', 'border', 'border-sky-300/35', 'bg-sky-300/10', 'p-1', 'shadow-sm', 'shadow-stone-950/20');

          const previewUrl = attachmentPreviewUrls[attachment.clientId];
          if (previewUrl) {
            const image = document.createElement('img');
            image.src = previewUrl;
            image.alt = attachment.originalName || 'Pasted image';
            image.className = 'h-[4.5rem] w-[6rem] rounded-[0.7rem] bg-stone-950 object-contain';
            image.draggable = false;
            token.append(image);
          } else {
            const imagePlaceholder = document.createElement('span');
            imagePlaceholder.className =
              'inline-block h-[4.5rem] w-[6rem] rounded-[0.7rem] bg-stone-900/80';
            imagePlaceholder.setAttribute('aria-hidden', 'true');
            token.append(imagePlaceholder);
          }

          const caption = document.createElement('span');
          caption.className = 'ml-2 inline-flex max-w-[8rem] items-center text-[10px] font-medium tracking-[0.08em] text-sky-50';
          caption.textContent = attachmentDisplayLabel(attachment);

          token.append(caption);
        } else {
          token.classList.add(
            'items-center',
            'gap-2',
            'rounded-[0.95rem]',
            'border',
            'border-emerald-300/35',
            'bg-emerald-300/10',
            'px-2.5',
            'py-2',
            'text-[10px]',
            'font-medium',
            'tracking-[0.08em]',
            'text-emerald-50',
            'shadow-sm',
            'shadow-stone-950/20',
          );

          const icon = document.createElement('span');
          icon.className = 'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-emerald-200/25 bg-emerald-300/12 text-[9px]';
          icon.textContent = 'FILE';

          const label = document.createElement('span');
          label.className = 'inline-flex max-w-[10rem] truncate';
          label.textContent = attachmentDisplayLabel(attachment);

          token.append(icon, label);
        }

        fragment.append(token);
      }

      editor.replaceChildren(fragment);
      renderedPreviewSignatureRef.current = previewSignature;
    }

    if (pendingSelection !== null) {
      editor.focus();
      if (!restoreSelectionAfterInsertedAttachments(editor)) {
        restoreSelection(pendingSelection);
      }
      selectionSnapshotRef.current = pendingSelection;
    } else if (document.activeElement === editor && shouldSyncDom) {
      restoreSelection(selectionSnapshotRef.current);
    }

    pendingSelectionRef.current = null;
    pendingInsertedAttachmentIdsRef.current = [];
  }, [attachmentPreviewUrls, isShellView, previewSignature, prompt, promptSegments]);

  function dismissPromptFocus() {
    promptRef.current?.blur();
    if (
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
    ) {
      document.activeElement.blur();
    }
  }

  async function pasteClipboardIntoPrompt() {
    dismissPromptFocus();
    setOpenMenu(null);

    if (!navigator.clipboard?.readText) {
      return;
    }

    try {
      const clipboardText = await navigator.clipboard.readText();
      if (!clipboardText) {
        return;
      }

      const selection = snapshotSelection() ?? selectionSnapshotRef.current;
      const start = selection?.start ?? prompt.length;
      const end = selection?.end ?? start;
      const nextPrompt = `${prompt.slice(0, start)}${clipboardText}${prompt.slice(end)}`;
      updateDraft((current) => ({
        prompt: nextPrompt,
        attachments: current.attachments,
      }));
      const nextCaret = start + clipboardText.length;
      pendingSelectionRef.current = {
        start: nextCaret,
        end: nextCaret,
      };
    } catch {
      return;
    }
  }

  async function submitPrompt() {
    if (!isShellView && !prompt.trim()) {
      return;
    }

    const normalizedPrompt = isShellView ? prompt : prompt.trim();
    const activeAttachments = isShellView
      ? []
      : attachments.filter((attachment) => normalizedPrompt.includes(attachment.placeholder));

    await onSubmit(
      activeAttachments.length > 0
        ? { prompt: normalizedPrompt, attachments: activeAttachments }
        : { prompt: normalizedPrompt }
    );
    updateDraft(() => ({
      prompt: '',
      attachments: [],
    }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitPrompt();
  }

  function handlePromptInput() {
    const nextPrompt = serializeEditorPrompt();
    const nextSelection = snapshotSelection();
    selectionSnapshotRef.current = nextSelection;

    updateDraft((current) => ({
      prompt: nextPrompt,
      attachments: current.attachments.filter((attachment) =>
        nextPrompt.includes(attachment.placeholder),
      ),
    }));
  }

  function handlePromptPaste(event: ClipboardEvent<HTMLDivElement>) {
    const files = extractFilesFromTransfer(
      event.clipboardData?.items,
      event.clipboardData?.files,
    );
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    appendDroppedAttachments(files);
  }

  function handlePromptDragEnter(event: DragEvent<HTMLDivElement>) {
    if (!hasTransferFiles(event.dataTransfer?.items, event.dataTransfer?.files)) {
      return;
    }

    event.preventDefault();
    setIsDragTargetActive(true);
  }

  function handlePromptDragOver(event: DragEvent<HTMLDivElement>) {
    if (!hasTransferFiles(event.dataTransfer?.items, event.dataTransfer?.files)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    setIsDragTargetActive(true);
  }

  function handlePromptDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setIsDragTargetActive(false);
  }

  function handlePromptDrop(event: DragEvent<HTMLDivElement>) {
    const files = extractFilesFromTransfer(
      event.dataTransfer?.items,
      event.dataTransfer?.files,
    );
    if (files.length === 0) {
      return;
    }

    event.preventDefault();
    setIsDragTargetActive(false);
    appendDroppedAttachments(files);
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Enter') {
      return;
    }

    if (!event.metaKey && !event.ctrlKey) {
      return;
    }

    event.preventDefault();

    if (busy || disabled) {
      return;
    }

    void submitPrompt();
  }

  async function handleUpdateSettings(input: UpdateThreadSettingsInput) {
    await onUpdateSettings?.(input);
    setOpenMenu(null);
  }

  const promptPlaceholder =
    disabledPlaceholder ??
    (isShellView
      ? 'Send shell input to the attached terminal...'
      : 'Ask Codex to inspect, modify, or explain code...');
  const interruptLabel = isShellView ? 'Send Ctrl-C' : 'Stop Current Turn';
  const sendButtonLabel =
    !threadConnected && busy
      ? 'Connecting...'
      : !threadConnected
      ? 'Send'
      : busy && !isShellView
        ? 'Sending...'
        : 'Send';
  const sendButtonClassName = !threadConnected
    ? 'bg-rose-400/92 text-rose-950 hover:bg-rose-300'
    : 'bg-amber-300/95 text-stone-950 hover:bg-amber-200';
  const formClassName = edgeToEdgeMobile || isMobileShell
    ? 'relative z-20 shrink-0 bg-transparent px-3 pb-0 pt-3 sm:p-4'
    : 'relative z-20 shrink-0 bg-transparent px-3 pb-3 pt-0 sm:px-4 sm:pb-4 sm:pt-0';
  const promptInputClassName =
    `min-h-[9.75rem] w-full rounded-[1.25rem] border bg-stone-900 px-4 pr-14 pt-2.5 text-stone-100 outline-none transition sm:min-h-[8.25rem] ${
      isDragTargetActive
        ? 'border-sky-300/80 bg-sky-300/[0.08] shadow-[0_0_0_1px_rgba(125,211,252,0.2)]'
        : 'border-stone-700 focus-within:border-amber-300'
    }`;

  return (
    <div className="relative z-20 shrink-0">
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        multiple
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          appendAttachments(event.target.files, 'photo');
          event.target.value = '';
        }}
      />
      <input
        ref={fileInputRef}
        type="file"
        multiple
        tabIndex={-1}
        className="sr-only"
        onChange={(event) => {
          appendAttachments(event.target.files, 'file');
          event.target.value = '';
        }}
      />

      {activeView === 'chat' && (
        <button
          type="button"
          aria-label="Jump to latest"
          title={followTail ? 'Latest turn is in view' : 'Jump to the latest messages'}
          onClick={() => onToggleFollow?.()}
          className="absolute left-1/2 top-3 z-40 inline-flex h-9 min-w-[5.75rem] -translate-x-1/2 -translate-y-[62%] items-start justify-center bg-transparent pt-1 touch-manipulation sm:top-4"
        >
          <span
            className={`pointer-events-none inline-flex h-4 min-w-[3.75rem] items-center justify-center rounded-[0.7rem] border shadow-sm transition ${
              followTail
                ? 'border-sky-300/36 bg-sky-300/[0.03] text-sky-100/86'
                : 'border-stone-500/70 bg-stone-950/[0.08] text-stone-200/86'
            }`}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 fill-none stroke-current"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m4 6 4 4 4-4" />
            </svg>
          </span>
        </button>
      )}

      <form
        ref={menuRef}
        onSubmit={handleSubmit}
        className={formClassName}
      >
        <div
          className="relative z-30 mb-0 flex items-center gap-2 rounded-full border border-stone-800/40 bg-stone-950/18 px-2.5 py-1.5 text-xs shadow-lg shadow-stone-950/8"
        >
          <div className="flex shrink-0 items-center gap-1.5">
            {!isShellView && (
              <div className="relative">
                <button
                  type="button"
                  aria-label="Add attachment"
                  title="Add attachment"
                  onClick={() =>
                    setOpenMenu((current) =>
                      current === 'attachments' ? null : 'attachments',
                    )
                  }
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-700 bg-stone-900/92 text-stone-200 transition hover:bg-stone-800"
                >
                  <PlusIcon />
                </button>

                {openMenu === 'attachments' && (
                  <div className="absolute left-0 top-full mt-2 w-32 overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40">
                    <div className="p-2">
                      <button
                        type="button"
                        onClick={() => {
                          dismissPromptFocus();
                          photoInputRef.current?.click();
                        }}
                        className="block w-full rounded-xl px-3 py-2 text-left text-sm text-stone-200 transition hover:bg-stone-800"
                      >
                        Photo
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          dismissPromptFocus();
                          fileInputRef.current?.click();
                        }}
                        className="mt-1 block w-full rounded-xl px-3 py-2 text-left text-sm text-stone-200 transition hover:bg-stone-800"
                      >
                        File
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              aria-label={isShellView ? 'Switch to chat' : 'Switch to shell'}
              title={isShellView ? 'Switch to chat' : 'Switch to shell'}
              onClick={() => onToggleView?.()}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-700 bg-stone-900/92 text-stone-200 transition hover:bg-stone-800"
            >
              {isShellView ? <ChatIcon /> : <TerminalIcon />}
            </button>
          </div>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            {isShellView && shellPromptLabel && (
              <span
                className="min-w-0 max-w-[12rem] truncate rounded-full px-1.5 py-1 text-stone-400"
                title={shellPromptLabel}
              >
                {shellPromptLabel}
              </span>
            )}

            {isMobileShell && (
              <div className="relative">
                <button
                  type="button"
                  aria-label={openMenu === 'shellTools' ? 'Close shell tools' : 'Open shell tools'}
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'shellTools'}
                  title={openMenu === 'shellTools' ? 'Close shell tools' : 'Open shell tools'}
                  onClick={() => {
                    dismissPromptFocus();
                    setOpenMenu((current) => (current === 'shellTools' ? null : 'shellTools'))
                  }}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-stone-700 bg-stone-900/92 text-stone-200 transition hover:bg-stone-800"
                >
                  <WrenchScrewdriverIcon />
                </button>
                {openMenu === 'shellTools' && (
                  <div
                    className="absolute right-0 top-full z-40 mt-2 w-[11.5rem] max-w-[calc(100vw-1.5rem)] rounded-[1rem] border border-stone-700/90 bg-stone-950/96 p-2 shadow-2xl shadow-stone-950/40 sm:w-48"
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                    }}
                    onTouchStart={(event) => {
                      event.stopPropagation();
                    }}
                  >
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => void pasteClipboardIntoPrompt()}
                        className="inline-flex items-center justify-center rounded-full border border-sky-300/35 bg-sky-300/12 px-2 py-2 text-sky-50"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <ClipboardIcon />
                          <span className="text-[10px] font-medium tracking-[0.12em]">
                            Paste
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellCopy?.();
                        }}
                        className="inline-flex items-center justify-center rounded-full border border-stone-700/90 bg-stone-900/80 px-2 py-2 text-stone-100"
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <ClipboardIcon />
                          <span className="text-[10px] font-medium tracking-[0.12em]">
                            Copy
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onSubmit({ prompt: 'clear' });
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="CLEAR" tone="sky" />
                      </button>
                      <button
                        type="button"
                        disabled={
                          !shellControlState?.shellInputEnabled ||
                          !shellControlState?.isCommandRunning
                        }
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('ctrl_c');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="CTRL-C" tone="rose" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('ctrl_d');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="CTRL-D" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('esc');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="ESC" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('tab');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="TAB" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('up');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="UP" />
                      </button>
                      <button
                        type="button"
                        disabled={!shellControlState?.shellInputEnabled}
                        onClick={() => {
                          dismissPromptFocus();
                          setOpenMenu(null);
                          void onShellControl?.('down');
                        }}
                        className="disabled:cursor-not-allowed disabled:opacity-45"
                      >
                        <ToolPill label="DOWN" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="relative">
          {isShellView ? (
            <textarea
              aria-label="Prompt"
              disabled={false}
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={
                handlePromptKeyDown as unknown as (
                  event: KeyboardEvent<HTMLTextAreaElement>,
                ) => void
              }
              rows={2}
              placeholder={promptPlaceholder}
              className={`${promptInputClassName} resize-y pb-10`}
            />
          ) : (
            <div className={promptInputClassName}>
              {prompt.length === 0 && (
                <span className="pointer-events-none absolute left-4 top-2.5 text-stone-500">
                  {promptPlaceholder}
                </span>
              )}
              <div
                ref={promptRef}
                role="textbox"
                aria-label="Prompt"
                aria-multiline="true"
                contentEditable={!disabled}
                suppressContentEditableWarning
                onInput={() => handlePromptInput()}
                onPaste={handlePromptPaste}
                onKeyDown={handlePromptKeyDown}
                onKeyUp={() => {
                  selectionSnapshotRef.current = snapshotSelection();
                }}
                onMouseUp={() => {
                  selectionSnapshotRef.current = snapshotSelection();
                }}
                onBlur={() => {
                  selectionSnapshotRef.current = snapshotSelection();
                  setIsDragTargetActive(false);
                }}
                onDragEnter={handlePromptDragEnter}
                onDragOver={handlePromptDragOver}
                onDragLeave={handlePromptDragLeave}
                onDrop={handlePromptDrop}
                className={`relative z-[1] min-h-[7.75rem] whitespace-pre-wrap break-words pb-10 outline-none sm:min-h-[6.5rem] ${
                  disabled ? 'cursor-not-allowed text-stone-500' : ''
                }`}
              />
            </div>
          )}
          <button
            type="button"
            aria-label={interruptLabel}
            title={interruptLabel}
            onClick={() => void onInterrupt?.()}
            disabled={!canInterrupt}
            className={`absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
              canInterrupt
                ? 'border-rose-300/55 bg-rose-300/[0.14] text-rose-50 shadow-lg shadow-rose-950/20 hover:bg-rose-300/[0.22]'
                : 'cursor-not-allowed border-stone-700/30 bg-stone-400/[0.02] text-stone-500/55 opacity-55'
            }`}
          >
            <span
              aria-hidden="true"
              className="block h-2.5 w-2.5 rounded-[2px] bg-current"
            />
          </button>
          <button
            type="submit"
            aria-label={isShellView ? 'Send Shell Input' : 'Send Prompt'}
            onMouseDown={(event) => {
              event.preventDefault();
            }}
            onPointerDown={(event) => {
              event.preventDefault();
            }}
            onTouchStart={(event) => {
              event.preventDefault();
            }}
            disabled={busy || (activeView === 'chat' ? disabled : false)}
            className={`absolute bottom-2.5 right-2.5 rounded-full px-3.5 py-1.5 text-sm font-medium shadow-lg shadow-stone-950/30 transition disabled:cursor-not-allowed disabled:bg-stone-700 disabled:text-stone-300 ${sendButtonClassName}`}
          >
            {sendButtonLabel}
          </button>
          {!isShellView && (
            <div className="absolute bottom-2.5 left-3 z-30 flex max-w-[calc(100%-7rem)] items-center gap-1.5 text-xs">
              <div className="relative min-w-0">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'model'}
                  aria-label={model ?? 'Select model'}
                  disabled={settingsBusy || modelOptions.length === 0}
                  onClick={() =>
                    setOpenMenu((current) => (current === 'model' ? null : 'model'))
                  }
                  title={modelContextTitle}
                  className="relative inline-flex min-w-0 max-w-[8.75rem] items-center overflow-hidden rounded-full px-2.5 py-1 text-left text-stone-300 transition hover:bg-stone-800/85 hover:text-stone-100 disabled:cursor-not-allowed disabled:text-stone-600 sm:max-w-[11rem]"
                >
                  {model ? <ContextRingFrame contextUsage={contextUsage} /> : null}
                  <span className="relative z-[1] block min-w-0 truncate whitespace-nowrap [direction:rtl]">
                    {model ?? 'Select model'}
                  </span>
                </button>
                {openMenu === 'model' && (
                  <div className="absolute bottom-full left-0 mb-2 w-max min-w-[9rem] max-w-[14rem] overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40">
                    <div className="max-h-72 overflow-auto p-2">
                      {modelOptions.map((entry) => (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() =>
                            void handleUpdateSettings({
                              model: entry.model,
                              reasoningEffort: entry.defaultReasoningEffort,
                            })
                          }
                          className={`block w-full rounded-xl px-3 py-2 text-left transition ${
                            entry.model === model
                              ? 'bg-amber-300/12 text-stone-100'
                              : 'text-stone-300 hover:bg-stone-800'
                          }`}
                        >
                          <p className="text-sm font-medium">{entry.model}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div className="relative">
                <button
                  type="button"
                  aria-haspopup="menu"
                  aria-expanded={openMenu === 'effort'}
                  disabled={settingsBusy || supportedEfforts.length === 0}
                  onClick={() =>
                    setOpenMenu((current) => (current === 'effort' ? null : 'effort'))
                  }
                  className="rounded-full px-2 py-1 text-stone-500 transition hover:bg-stone-800 hover:text-stone-200 disabled:cursor-not-allowed disabled:text-stone-700"
                >
                  {formatReasoningEffortLabel(reasoningEffort)}
                </button>
                {openMenu === 'effort' && (
                  <div className="absolute bottom-full left-0 mb-2 w-max min-w-[8rem] max-w-[12rem] overflow-hidden rounded-2xl border border-stone-700 bg-stone-900 shadow-2xl shadow-stone-950/40">
                    <div className="max-h-72 overflow-auto p-2">
                      {supportedEfforts.map((entry) => (
                        <button
                          key={entry.reasoningEffort}
                          type="button"
                          onClick={() =>
                            void handleUpdateSettings({
                              reasoningEffort: entry.reasoningEffort,
                            })
                          }
                          className={`block w-full rounded-xl px-3 py-2 text-left transition ${
                            entry.reasoningEffort === reasoningEffort
                              ? 'bg-amber-300/12 text-stone-100'
                              : 'text-stone-300 hover:bg-stone-800'
                          }`}
                        >
                          <p className="text-sm font-medium">
                            {formatReasoningEffortLabel(entry.reasoningEffort)}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                aria-pressed={collaborationMode === 'plan'}
                disabled={settingsBusy}
                onClick={() =>
                  void handleUpdateSettings({
                    collaborationMode:
                      collaborationMode === 'plan' ? 'default' : 'plan',
                  })
                }
                className={`rounded-full px-2.5 py-1 transition ${
                  collaborationMode === 'plan'
                    ? 'bg-sky-300/18 text-sky-100'
                    : 'text-stone-500 hover:bg-stone-800 hover:text-stone-200'
                } disabled:cursor-not-allowed disabled:opacity-60`}
              >
                Plan
              </button>
            </div>
          )}
        </div>
        {error && (
          <div className="mt-2 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {error}
          </div>
        )}
      </form>
    </div>
  );
}
