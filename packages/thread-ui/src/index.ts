import './styles.css';

export type {
  ShellSocketConnection,
  ShellSocketHandlers,
  ThreadDetailUiAdapter,
  ThreadShellAdapter,
  ThreadTimelineAdapter,
  ThreadWorkspaceAdapter,
} from './adapters';
export type {
  PromptAttachmentUpload,
  SendPromptInput,
  ThreadShellControlState,
} from './types';

export {
  ThreadComposer,
  type ThreadComposerProps,
} from './components/ThreadComposer';
export {
  ThreadCards,
  ThreadWorkspaceLayout,
} from './components/ThreadWorkspaceLayout';
export {
  ThreadTimeline,
  type ThreadTimelineProps,
} from './components/ThreadTimeline';
export {
  ThreadShellPanel,
  type ThreadShellPanelHandle,
} from './components/ThreadShellPanel';
export { ThreadGraphWorkspacePanel } from './components/ThreadGraphWorkspacePanel';
export { ConfirmDialog } from './components/ConfirmDialog';
export { ExportTranscriptDialog } from './components/ExportTranscriptDialog';
export { LongTextDialog } from './components/LongTextDialog';
export {
  formatLongTimestamp,
  formatShortTimestamp,
  historyItemAccentClassName,
  historyItemLabel,
  threadStatusClassName,
  threadStatusLabel,
  turnStatusLabel,
} from './components/threadPresentation';
export { hasLikelyMarkdownSyntax } from './components/markdownHeuristics';
export {
  ThreadDetailSurface,
  type ThreadDetailSurfaceProps,
} from './ThreadDetailSurface';

export { builtinFrontendPlugins } from './plugins/builtin-plugin-modules';
export {
  PluginContext,
  mergePluginState,
  type PluginContextValue,
} from './plugins/plugin-context';
export { PluginProvider } from './plugins/PluginProvider';
export { usePlugins } from './plugins/usePlugins';
export type {
  ArtifactRenderContext,
  FrontendPluginModule,
  InlineCodeRenderContext,
  ThreadPanelContribution,
} from './plugins/plugin-types';
export {
  InlineXyzRenderer,
  XyzArtifactRenderer,
} from './plugins/xyz-plugin-renderers';
export {
  AppShellNavContext,
  useAppShellNav,
  type AgentBackendId,
  type AppShellNavContextValue,
  type ThemeMode,
} from './app-shell/AppShellNavContext';
export {
  AppShellMenuButton,
  AppShellNavigationMenu,
  AppShellSettingsDialog,
  type AppShellNavigationItem,
  type AppShellNavigationMenuProps,
  type AppShellSettingsDialogProps,
} from './app-shell/AppShellNavigation';
