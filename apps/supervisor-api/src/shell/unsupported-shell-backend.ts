import type {
  ShellBackend,
  ShellBackendAttachOptions,
  ShellBackendCreateInput,
} from './shell-backend';
import { ShellServiceError } from './shell-session-service';

export class UnsupportedShellBackend implements ShellBackend {
  readonly kind = 'unsupported';

  constructor(
    private readonly reason = 'The Terminal plugin is not available on this platform.',
  ) {}

  sessionNameForThread(threadId: string) {
    return `unsupported-${threadId}`;
  }

  async listSessionNames() {
    return [];
  }

  async hasSession(_sessionId: string) {
    return false;
  }

  async createSession(_input: ShellBackendCreateInput): Promise<void> {
    this.throwUnavailable();
  }

  async attach(_sessionId: string, _options: ShellBackendAttachOptions): Promise<never> {
    return this.throwUnavailable();
  }

  async sendInput(): Promise<void> {
    this.throwUnavailable();
  }

  async clear(): Promise<never> {
    return this.throwUnavailable();
  }

  async resize(): Promise<void> {
    this.throwUnavailable();
  }

  async snapshot(): Promise<never> {
    return this.throwUnavailable();
  }

  async killSession(): Promise<void> {
    // There cannot be a live terminal session on an unsupported platform.
  }

  private throwUnavailable(): never {
    throw new ShellServiceError('plugin_disabled', this.reason);
  }
}
