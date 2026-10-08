import { useI18n } from '@remote-codex/thread-ui/i18n';

/** Search copy uses the same locale store and paired resources as the workbench. */
export function useSearchMessages() {
  const { t } = useI18n();
  return {
    trigger: t('search.trigger'),
    input: t('search.input'),
    close: t('search.close'),
    placeholder: t('search.placeholder'),
    globalPlaceholder: t('search.globalPlaceholder'),
    scope: t('search.scope'),
    thread: t('search.thread'),
    workspace: t('search.workspace'),
    device: t('search.device'),
    results: t('search.results'),
    matches: t('search.matches'),
    opening: t('search.opening'),
    searching: t('search.searching'),
    empty: t('search.empty'),
    failed: t('search.failed'),
    openFailed: t('search.openFailed'),
    more: t('search.more'),
    previous: t('search.previous'),
    refine: t('search.refine'),
    localScope: t('search.localScope'),
    you: t('search.you'),
    assistant: t('search.assistant'),
    title: t('search.title'),
    localDevice: t('search.localDevice'),
    count: (count: number, more: boolean) => t('search.count', { count, more: more ? '+' : '' }),
  };
}
