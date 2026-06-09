import type {
  ShellEventEnvelope,
  ShellSessionDto,
  ThreadDto,
  ThreadHistoryItemDetailDto,
  ThreadShellStateDto,
  UpdateShellInput,
  UpdateThreadSettingsInput,
} from '@remote-codex/shared';
import type { SendPromptInput } from './types';

export interface ThreadTimelineAdapter {
  getImageAssetUrl?: (input: { threadId: string; path: string }) => string;
  onOpenLinkedThread?: (threadId: string) => void;
  onLoadHistoryItemDetail?: (
    itemId: string,
  ) => Promise<ThreadHistoryItemDetailDto> | ThreadHistoryItemDetailDto;
}

export interface ShellSocketHandlers {
  onConnected?: (event: unknown) => void;
  onShellEvent?: (event: ShellEventEnvelope) => void;
}

export interface ShellSocketConnection {
  socket: WebSocket;
  send(message: unknown): void;
  close?: () => void;
}

export interface ThreadWorkspaceTreeNode {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size?: number;
  children?: ThreadWorkspaceTreeNode[];
}

export interface ThreadWorkspaceFilePreview {
  path: string;
  name: string;
  content: string;
  language: string;
  size: number;
  truncated: boolean;
  nextOffset: number;
}

export type ThreadWorkspaceUploadResult =
  | {
      kind: 'file';
      file: {
        path: string;
        name: string;
        size: number;
      };
    }
  | {
      kind: 'archive';
      archiveName: string;
      extractedCount: number;
      paths: string[];
    };

export interface ThreadWorkspaceAdapter {
  listTree(input: {
    threadId: string;
    workspaceId?: string | null;
  }): Promise<ThreadWorkspaceTreeNode>;
  readFile(input: {
    threadId: string;
    workspaceId?: string | null;
    path: string;
    offset?: number;
    limit?: number;
  }): Promise<ThreadWorkspaceFilePreview>;
  getRawFileUrl?: (input: {
    threadId: string;
    workspaceId?: string | null;
    path: string;
  }) => string;
  uploadFile?: (input: {
    threadId: string;
    workspaceId?: string | null;
    path: string;
    file: File;
  }) => Promise<ThreadWorkspaceUploadResult>;
  downloadNode?: (input: {
    threadId: string;
    workspaceId?: string | null;
    path: string;
    kind: 'file' | 'directory';
  }) => Promise<void> | void;
  listGarbage?: (input: {
    threadId: string;
    workspaceId?: string | null;
  }) => Promise<string[]>;
  emptyGarbage?: (input: {
    threadId: string;
    workspaceId?: string | null;
  }) => Promise<void> | void;
  subscribeWorkspaceChanged?: (
    input: {
      threadId: string;
      workspaceId?: string | null;
    },
    onChanged: () => void,
  ) => (() => void) | void;
}

export interface ThreadShellAdapter {
  fetchState(threadId: string): Promise<ThreadShellStateDto>;
  createShell(
    threadId: string,
    input?: { cols?: number; rows?: number; label?: string },
  ): Promise<ThreadShellStateDto>;
  terminateShell(shellId: string): Promise<ShellSessionDto>;
  updateShell(
    shellId: string,
    input: UpdateShellInput,
  ): Promise<ShellSessionDto>;
  connectSocket(handlers: ShellSocketHandlers): ShellSocketConnection;
}

export interface ThreadDetailUiAdapter {
  openThread(threadId: string): void;
  getThreadHref?: (threadId: string) => string;
  getNewThreadHref?: (workspaceId?: string | null) => string;
  renameThread?: (threadId: string, title: string) => Promise<void> | void;
  deleteThread?: (thread: ThreadDto) => Promise<void> | void;
  sendPrompt(input: SendPromptInput): Promise<boolean | void> | boolean | void;
  interrupt?: () => Promise<void> | void;
  compact?: () => Promise<void> | void;
  updateSettings?: (input: UpdateThreadSettingsInput) => Promise<void> | void;
  loadHistoryItemDetail?: (
    itemId: string,
  ) => Promise<ThreadHistoryItemDetailDto> | ThreadHistoryItemDetailDto;
  getImageAssetUrl?: (path: string) => string;
  workspace?: ThreadWorkspaceAdapter | null;
  shell?: ThreadShellAdapter | null;
}
