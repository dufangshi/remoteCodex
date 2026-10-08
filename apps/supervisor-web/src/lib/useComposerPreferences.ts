import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ComposerSendShortcut } from '@remote-codex/thread-ui';
import { relayModeActive } from './api';
import {
  fetchComposerPreferences,
  saveComposerPreferences,
} from './composerPreferences';

export function useComposerPreferences() {
  useI18n();
  const enabled = relayModeActive();
  const [sendShortcut, setShortcut] =
    useState<ComposerSendShortcut>('ctrlEnter');
  const [loading, setLoading] = useState(enabled);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const savingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!enabled || savingRef.current) return;
    const current = ++revision.current;
    setLoading(true);
    try {
      const preferences = await fetchComposerPreferences();
      if (current !== revision.current) return;
      setShortcut(preferences.sendShortcut);
      setReady(true);
      setError(null);
    } catch (caught) {
      if (current !== revision.current) return;
      setError(
        caught instanceof Error
          ? caught.message
          : translate("settings.unableToLoadYourMessageShortcuts"),
      );
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
    const onFocus = () => {
      void refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      revision.current += 1;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [refresh]);

  const save = useCallback(
    async (shortcut: ComposerSendShortcut) => {
      if (!enabled || !ready || savingRef.current) return;
      const current = ++revision.current;
      savingRef.current = true;
      setLoading(false);
      setSaving(true);
      setError(null);
      try {
        const preferences = await saveComposerPreferences(shortcut);
        if (current === revision.current) setShortcut(preferences.sendShortcut);
      } catch (caught) {
        if (current === revision.current) {
          setError(
            caught instanceof Error
              ? caught.message
              : translate("settings.unableToSaveYourMessageShortcuts"),
          );
        }
      } finally {
        savingRef.current = false;
        if (current === revision.current) setSaving(false);
      }
    },
    [enabled, ready],
  );

  return {
    sendShortcut,
    ...(enabled ? { setSendShortcut: save, refreshSendShortcut: refresh } : {}),
    sendShortcutLoading: enabled && (loading || !ready),
    sendShortcutSaving: saving,
    sendShortcutError: error,
  };
}
