import type { ComposerSendShortcut } from '@remote-codex/thread-ui';
import { request } from './api';

interface ComposerPreferences {
  sendShortcut: ComposerSendShortcut;
}

function checked(preferences: ComposerPreferences) {
  if (!['ctrlEnter', 'enter'].includes(preferences.sendShortcut)) {
    throw new Error('Unable to read your message shortcuts.');
  }
  return preferences;
}

export async function fetchComposerPreferences() {
  return checked(
    await request<ComposerPreferences>('/relay/account/preferences', {
      cache: 'no-store',
    }),
  );
}

export async function saveComposerPreferences(
  sendShortcut: ComposerSendShortcut,
) {
  return checked(
    await request<ComposerPreferences>('/relay/account/preferences', {
      method: 'PATCH',
      body: JSON.stringify({ sendShortcut }),
    }),
  );
}
