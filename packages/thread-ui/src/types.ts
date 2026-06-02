import type {
  PromptAttachmentManifestEntryDto,
} from '@remote-codex/shared';

export interface PromptAttachmentUpload
  extends PromptAttachmentManifestEntryDto {
  file: File;
}

export type SendPromptInput = {
  prompt: string;
  attachments?: PromptAttachmentUpload[];
};

export interface ThreadShellControlState {
  status: import('@remote-codex/shared').ShellStatusDto;
  connectionButtonDisabled: boolean;
  connectionButtonLabel: string;
  shellInputEnabled: boolean;
  isConnecting: boolean;
  isCommandRunning: boolean;
  promptLabel: string | null;
  isMobileShell: boolean;
  hasShell: boolean;
  busy: boolean;
  loading: boolean;
  error: string | null;
}
