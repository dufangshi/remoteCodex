import { translate, useI18n } from '@remote-codex/thread-ui/i18n';
import { useState } from 'react';

// Adapter data is metadata only: names and descriptions render as text.
export interface DshPlugin {
  id: string;
  name: string;
  module: string;
  description: string;
  enabled: boolean;
  active: boolean;
  readOnly: string | null;
}
export interface DshBundle {
  name: string;
  version: string | null;
  description: string;
  enabled: boolean;
  removable: boolean;
  readOnly: string | null;
}
export interface DshHarnessInfo {
  kind: 'dsh';
  version: string | null;
  profile: string;
  permissionPresets: string[];
  plugins: DshPlugin[];
  bundles: DshBundle[];
  providers: { id: string; name: string; declared: boolean }[];
  session?: {
    running: boolean;
    projections: {
      plan?: { active: boolean; pending: boolean } | null;
      permissions?: { currentValue: string } | null;
      goal?: {
        goal: { objective: string; phase: string };
        roundsStarted: number;
      } | null;
      todos?: { content: string; status: string }[] | null;
    };
  };
}
type SettingValue = string | number | boolean | null;
export interface DshSettingsView {
  ns: string;
  revision: number;
  fields: { key: string; value: SettingValue; overridden: boolean }[];
}
export type DshPanelAction =
  | { kind: 'refresh' }
  | { kind: 'settings' }
  | { kind: 'stop' }
  | { kind: 'setPluginEnabled'; id: string; enabled: boolean }
  | { kind: 'setBundleEnabled'; name: string; enabled: boolean }
  | {
      kind: 'updateSetting';
      ns: string;
      key: string;
      value: SettingValue;
      revision: number;
    };
export interface DshPanelResult {
  result?: { application?: string } | null;
  harness?: DshHarnessInfo;
  settings?: DshSettingsView[];
}

export function isDshHarness(info: unknown): info is DshHarnessInfo {
  return (info as { kind?: unknown } | null)?.kind === 'dsh';
}

const SELECTS: Record<string, (info: DshHarnessInfo) => string[]> = {
  'permission.defaultPreset': (info) => info.permissionPresets,
  'llm-deepseek.reasoningEffort': () => ['off', 'low', 'high', 'max'],
};

export function DshHarnessPanel({
  info: initial,
  readOnly,
  runAction,
  onReconnect,
}: {
  info: DshHarnessInfo;
  readOnly: boolean;
  runAction: (action: DshPanelAction) => Promise<DshPanelResult>;
  onReconnect?: () => Promise<void>;
}) {
  useI18n();
  const [info, setInfo] = useState(initial);
  const [settings, setSettings] = useState<DshSettingsView[] | null>(null);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  // The live inventory reports the running process; saved toggles load after reconnect.
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const run = async (action: DshPanelAction) => {
    // Toggles show the requested state at once and roll back on failure.
    const toggle = action.kind === 'setPluginEnabled' ? `plugin:${action.id}`
      : action.kind === 'setBundleEnabled' ? `bundle:${action.name}` : null;
    const previous = toggle ? pending[toggle] : undefined;
    const settle = (value: boolean | undefined) => {
      if (!toggle) return;
      setPending((current) => {
        const next = { ...current };
        if (value === undefined) delete next[toggle];
        else next[toggle] = value;
        return next;
      });
    };
    if (toggle && 'enabled' in action) settle(action.enabled);
    setBusy(true);
    setError(null);
    try {
      const response = await runAction(action);
      if (response.harness) setInfo(response.harness);
      if (response.settings) setSettings(response.settings);
      if (response.result?.application === 'restart-required') setRestartRequired(true);
      else if (toggle) settle(previous);
      return response;
    } catch (failure) {
      settle(previous);
      setError(failure instanceof Error ? failure.message : String(failure));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const updateSetting = async (
    view: DshSettingsView,
    key: string,
    value: SettingValue,
  ) => {
    const response = await run({
      kind: 'updateSetting',
      ns: view.ns,
      key,
      value,
      revision: view.revision,
    });
    const updated = response?.result as DshSettingsView | null | undefined;
    if (updated?.ns)
      setSettings((current) =>
        current?.map((entry) => (entry.ns === updated.ns ? updated : entry)) ??
        null,
      );
    else void run({ kind: 'settings' });
  };
  const disabled = readOnly || busy;
  const projections = info.session?.projections ?? {};
  const plan = projections.plan;
  const goal = projections.goal;
  const query = filter.toLowerCase();
  return (
    <section aria-label={translate('settings.harnessPlugins')} className="space-y-4">
      <div>
        <h3 className="font-semibold">
          {translate('settings.dshTitle', {
            value1: info.version ?? '',
            value2: info.profile,
          })}
        </h3>
        <p className="text-xs text-[var(--theme-fg-muted)]">
          {translate('settings.dshBridgeNotice')}
        </p>
      </div>
      {error && <p role="alert">{error}</p>}
      {info.session?.running && (
        <div role="status" className="flex items-center gap-2 rounded-md border p-2">
          <span className="flex-1">{translate('settings.dshAutonomous')}</span>
          <button type="button" className="host-button rounded-md border px-2 py-1"
            disabled={disabled} onClick={() => void run({ kind: 'stop' })}>
            {translate('settings.dshStop')}
          </button>
        </div>
      )}
      <section aria-label={translate('settings.dshSession')} className="space-y-1">
        <h4 className="font-semibold">{translate('settings.dshSession')}</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt>{translate('settings.dshPermissionPreset')}</dt>
          <dd>{projections.permissions?.currentValue ?? translate('settings.dshNone')}</dd>
          <dt>{translate('settings.dshPlanMode')}</dt>
          <dd>
            {translate(plan?.active ? 'settings.dshOn' : 'settings.dshOff')}
            {plan?.pending ? ` · ${translate('settings.dshPending')}` : ''}
          </dd>
          <dt>{translate('settings.dshGoal')}</dt>
          <dd className="break-words">
            {goal
              ? translate('settings.dshGoalState', {
                  value1: goal.goal.objective,
                  value2: goal.goal.phase,
                  value3: String(goal.roundsStarted),
                })
              : translate('settings.dshNone')}
          </dd>
        </dl>
        {!!projections.todos?.length && (
          <ul aria-label={translate('settings.dshTodos')} className="space-y-0.5 text-xs">
            {projections.todos.map((todo, index) => (
              <li key={index}>
                {todo.status === 'completed' ? '☑' : todo.status === 'in_progress' ? '◐' : '☐'}{' '}
                {todo.content}
              </li>
            ))}
          </ul>
        )}
      </section>
      <details
        onToggle={(event) => {
          if ((event.target as HTMLDetailsElement).open && !settings)
            void run({ kind: 'settings' });
        }}
      >
        <summary className="cursor-pointer font-semibold">
          {translate('settings.dshProfileSettings')}
        </summary>
        <p className="my-1 text-xs text-[var(--theme-fg-muted)]">
          {translate('settings.dshProfileSettingsNotice')}
        </p>
        {settings ? (
          <div className="space-y-2">
            {settings.flatMap((view) =>
              view.fields.map((field) => {
                const id = `${view.ns}.${field.key}`;
                const choices = SELECTS[id]?.(info);
                const label = (
                  <span className="font-mono text-xs">
                    {id}
                    {field.overridden && ` · ${translate('settings.dshCustomized')}`}
                  </span>
                );
                if (typeof field.value === 'boolean')
                  return (
                    <label key={id} className="flex items-center gap-2">
                      <input type="checkbox" aria-label={id} checked={field.value}
                        disabled={disabled}
                        onChange={(event) => void updateSetting(view, field.key, event.target.checked)} />
                      {label}
                    </label>
                  );
                if (choices)
                  return (
                    <label key={id} className="block">
                      {label}
                      <select className="host-input mt-1 w-full rounded-md border p-1" aria-label={id}
                        value={field.value === null ? '' : String(field.value)} disabled={disabled}
                        onChange={(event) =>
                          void updateSetting(view, field.key, event.target.value || null)
                        }>
                        <option value="">{translate('settings.dshDefault')}</option>
                        {choices.map((choice) => (
                          <option key={choice} value={choice}>{choice}</option>
                        ))}
                      </select>
                    </label>
                  );
                return (
                  <label key={id} className="block">
                    {label}
                    <input className="host-input mt-1 w-full rounded-md border p-1" aria-label={id}
                      type={typeof field.value === 'number' ? 'number' : 'text'}
                      defaultValue={field.value === null ? '' : String(field.value)}
                      disabled={disabled}
                      onBlur={(event) => {
                        const raw = event.target.value.trim();
                        const value = raw === '' ? null
                          : typeof field.value === 'number' ? Number(raw) : raw;
                        if (value !== field.value) void updateSetting(view, field.key, value);
                      }} />
                  </label>
                );
              }),
            )}
          </div>
        ) : (
          <p className="text-xs">{translate('settings.loading')}</p>
        )}
      </details>
      {restartRequired && (
        <div role="status" className="flex items-center gap-2 rounded-md border p-2 text-xs">
          <span className="flex-1">{translate('settings.dshRestartRequired')}</span>
          {onReconnect && (
            <button type="button" className="host-button rounded-md border px-2 py-1"
              disabled={disabled}
              onClick={() => {
                setBusy(true);
                void onReconnect()
                  .then(() => run({ kind: 'refresh' }))
                  .then(() => {
                    setRestartRequired(false);
                    setPending({});
                  })
                  .finally(() => setBusy(false));
              }}>
              {translate('settings.dshReconnect')}
            </button>
          )}
        </div>
      )}
      <section aria-label={translate('settings.plugins')} className="space-y-2">
        <h4 className="font-semibold">
          {translate('settings.plugins')} {info.profile} {translate('settings.profile')}
        </h4>
        <input className="host-input w-full rounded-md border p-2"
          aria-label={translate('settings.filterPlugins')}
          placeholder={translate('settings.filterPlugins')} value={filter}
          onChange={(event) => setFilter(event.target.value)} />
        <ul className="max-h-56 space-y-1 overflow-y-auto overscroll-contain">
          {info.plugins
            .filter((plugin) =>
              `${plugin.name} ${plugin.module}`.toLowerCase().includes(query),
            )
            .map((plugin) => {
              const saved = pending[`plugin:${plugin.id}`];
              const enabled = saved ?? plugin.enabled;
              return (
                <li className="flex items-center gap-2 break-all text-xs" key={plugin.id}
                  title={plugin.description}>
                  <input type="checkbox"
                    aria-label={translate('settings.dshEnable', { value1: plugin.name })}
                    checked={enabled}
                    disabled={disabled || Boolean(plugin.readOnly)}
                    onChange={(event) =>
                      void run({ kind: 'setPluginEnabled', id: plugin.id, enabled: event.target.checked })
                    } />
                  <span className="flex-1">{plugin.name}</span>
                  <span className="text-[var(--theme-fg-muted)]">
                    {plugin.readOnly
                      ? translate('settings.dshManaged')
                      : translate(enabled ? 'settings.enabled' : 'settings.disabled')}
                    {saved !== undefined && saved !== plugin.enabled
                      ? ` · ${translate('settings.dshAfterReconnect')}`
                      : ''}
                  </span>
                </li>
              );
            })}
        </ul>
      </section>
      <section aria-label={translate('settings.dshBundles')} className="space-y-1">
        <h4 className="font-semibold">{translate('settings.dshBundles')}</h4>
        <ul className="space-y-1 text-xs">
          {info.bundles.map((bundle) => {
            const saved = pending[`bundle:${bundle.name}`];
            return (
              <li className="flex items-center gap-2 break-all" key={bundle.name} title={bundle.description}>
                <input type="checkbox"
                  aria-label={translate('settings.dshEnable', { value1: bundle.name })}
                  checked={saved ?? bundle.enabled} disabled={disabled || Boolean(bundle.readOnly)}
                  onChange={(event) =>
                    void run({ kind: 'setBundleEnabled', name: bundle.name, enabled: event.target.checked })
                  } />
                <span className="flex-1">{bundle.name}</span>
                <span className="text-[var(--theme-fg-muted)]">
                  {bundle.version}
                  {saved !== undefined && saved !== bundle.enabled
                    ? ` · ${translate('settings.dshAfterReconnect')}`
                    : ''}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <section aria-label={translate('settings.dshProviders')} className="space-y-1">
        <h4 className="font-semibold">{translate('settings.dshProviders')}</h4>
        <ul className="max-h-32 space-y-0.5 overflow-y-auto text-xs">
          {info.providers.map((provider) => (
            <li key={provider.id} className="flex gap-2">
              <span className="flex-1">{provider.name}</span>
              {provider.declared && (
                <span className="text-[var(--theme-fg-muted)]">{translate('settings.dshInProfile')}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
