export interface ShellRuntimeInfo {
  cursorX?: number;
  cursorY?: number;
  paneWidth?: number;
  paneHeight?: number;
  panePid?: number;
  currentCommand?: string;
  currentPath?: string;
  envPrefix?: string | null;
  isCommandRunning?: boolean;
}

export interface ShellBackendSession {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
  snapshot: string;
  runtime: ShellRuntimeInfo;
}

export interface ShellBackendCreateInput {
  sessionId: string;
  threadId: string;
  cwd: string;
  cols?: number;
  rows?: number;
}

export interface ShellBackendAttachOptions {
  cols: number;
  rows: number;
  onData: (
    data: string,
    session: ShellBackendSession,
    options?: { replace?: boolean },
  ) => void;
  onExit: () => void;
}

export interface ShellBackendAttachment {
  dispose: () => void;
}

export interface ShellBackend {
  readonly kind: string;
  sessionNameForThread(threadId: string): string;
  listSessionNames(): Promise<string[]>;
  hasSession(sessionId: string): Promise<boolean>;
  createSession(input: ShellBackendCreateInput): Promise<void>;
  attach(
    sessionId: string,
    options: ShellBackendAttachOptions,
  ): Promise<{
    session: ShellBackendSession;
    attachment: ShellBackendAttachment;
  }>;
  sendInput(sessionId: string, data: string): Promise<void>;
  clear(sessionId: string): Promise<ShellBackendSession>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  snapshot(sessionId: string): Promise<ShellBackendSession>;
  killSession(sessionId: string): Promise<void>;
}
