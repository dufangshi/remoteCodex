import { type ReactNode } from 'react';
import {
  BarChart2,
  Code2,
  FileImage,
  FolderOpen,
  MessageSquare,
  MoveRight,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  Zap,
} from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './GraphAccordion';

function GuideTag({ children }: { children: ReactNode }) {
  return (
    <span className="thread-guide-tag inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px]">
      {children}
    </span>
  );
}

function GuideBullets({ items }: { items: ReactNode[] }) {
  return (
    <ul className="space-y-1 text-[12px] text-[var(--theme-fg-muted)]">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2">
          <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[var(--theme-border-contrast)]" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function SectionIcon({ children }: { children: ReactNode }) {
  return (
    <span className="thread-guide-icon flex h-5 w-5 shrink-0 items-center justify-center rounded-md">
      {children}
    </span>
  );
}

function GuideAccordionItem({
  value,
  title,
  icon,
  children,
}: {
  value: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <AccordionItem
      value={value}
      className="thread-guide-section border-b border-[var(--theme-border)] last:border-b-0"
    >
      <AccordionTrigger className="py-3 hover:no-underline [&[data-state=open]]:pb-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--theme-fg)]">
          <SectionIcon>{icon}</SectionIcon>
          {title}
        </div>
      </AccordionTrigger>
      <AccordionContent className="space-y-3 pb-3">{children}</AccordionContent>
    </AccordionItem>
  );
}

export function GraphGuidePanel() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-[var(--theme-border)] px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--theme-fg-muted)]">
          What can I do?
        </h2>
        <p className="mt-0.5 text-[11px] text-[var(--theme-fg-muted)]">
          Upload files, ask in plain language, get results.
        </p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-6">
        <Accordion
          type="multiple"
          defaultValue={['start', 'workspace', 'remote-codex']}
          className="space-y-0"
        >
        <GuideAccordionItem
          value="start"
          title="Getting Started"
          icon={<Zap className="h-3 w-3" />}
        >
          <p className="text-[11px] leading-5 text-[var(--theme-fg-muted)]">
            graphchat connects a language model to your files and a set of
            tools. Each Remote Codex thread has its own isolated workspace.
          </p>
          <GuideBullets
            items={[
              'Upload data files via the Workspace panel',
              'Type a question or task in plain language',
              'The agent calls tools, writes results to the workspace, and explains what it found',
              'Agent-produced files appear in the workspace automatically when the host reports changes',
            ]}
          />
        </GuideAccordionItem>

        <GuideAccordionItem
          value="workspace"
          title="Workspace Explorer"
          icon={<FolderOpen className="h-3 w-3" />}
        >
          <div className="flex items-start gap-2">
            <Upload className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--theme-fg-muted)]" />
            <div>
              <p className="text-[11px] font-medium text-[var(--theme-fg)]">
                Upload
              </p>
              <p className="text-[11px] leading-5 text-[var(--theme-fg-muted)]">
                Upload files through the Workspace panel when the host exposes
                workspace upload support. Composer attachments stay available
                for prompt context.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--theme-fg-muted)]" />
            <div>
              <p className="text-[11px] font-medium text-[var(--theme-fg)]">
                New files and folders
              </p>
              <p className="text-[11px] leading-5 text-[var(--theme-fg-muted)]">
                Remote Codex normally creates files through tools and shell
                commands. They appear in Explorer after workspace refreshes.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MoveRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--theme-fg-muted)]" />
            <div>
              <p className="text-[11px] font-medium text-[var(--theme-fg)]">
                Move and organize
              </p>
              <p className="text-[11px] leading-5 text-[var(--theme-fg-muted)]">
                Use the agent or terminal to reorganize files. Explorer keeps
                the GraphChat file tree and preview flow.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Trash2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
            <div>
              <p className="text-[11px] font-medium text-[var(--theme-fg)]">
                Garbage folder
              </p>
              <p className="text-[11px] leading-5 text-[var(--theme-fg-muted)]">
                If the host exposes garbage controls, Explorer can permanently
                empty unwanted workspace files.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <RefreshCw className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--theme-fg-muted)]" />
            <div>
              <p className="text-[11px] font-medium text-[var(--theme-fg)]">
                Refresh
              </p>
              <p className="text-[11px] leading-5 text-[var(--theme-fg-muted)]">
                Resync the file tree manually after shell commands, external
                changes, or agent tool runs.
              </p>
            </div>
          </div>
          <div className="rounded-lg border border-[var(--theme-border)] p-2.5">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--theme-fg-muted)]">
              Preview surfaces
            </p>
            <GuideBullets
              items={[
                <>
                  <GuideTag>.xyz .extxyz .cif</GuideTag> use the 3D molecule
                  plugin.
                </>,
                <>
                  <GuideTag>.png .jpg .gif .svg .webp</GuideTag> use inline
                  image preview.
                </>,
                <>
                  <GuideTag>.py .json .ts .md .csv</GuideTag> use text/code
                  preview.
                </>,
                'Large files load in chunks when the workspace adapter supports it.',
              ]}
            />
          </div>
        </GuideAccordionItem>

        <GuideAccordionItem
          value="viewer"
          title="Viewer"
          icon={<FileImage className="h-3 w-3" />}
        >
          <p className="text-[11px] leading-5 text-[var(--theme-fg-muted)]">
            Viewer is the GraphChat-style artifact surface. It opens Remote
            Codex artifacts through the same frontend plugin renderers used in
            rich message bubbles, and previews workspace files from Explorer.
          </p>
          <GuideBullets
            items={[
              'Expand one artifact at a time for inspection',
              'Fallback JSON preview is available for unknown artifact types',
              '3D molecule artifacts remain interactive when the XYZ plugin is enabled',
            ]}
          />
        </GuideAccordionItem>

        <GuideAccordionItem
          value="usage"
          title="Tool Usage & Chat"
          icon={<BarChart2 className="h-3 w-3" />}
        >
          <div className="flex items-start gap-2">
            <BarChart2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--theme-fg-muted)]" />
            <div>
              <p className="text-[11px] font-medium text-[var(--theme-fg)]">
                Usage tab
              </p>
              <GuideBullets
                items={[
                  'Bar chart of tool and command counts for this thread',
                  'Expandable call log: inspect every input and output',
                  'Recent live events appear with persisted history',
                ]}
              />
            </div>
          </div>
          <div className="flex items-start gap-2">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--theme-fg-muted)]" />
            <div>
              <p className="text-[11px] font-medium text-[var(--theme-fg)]">
                Chat controls
              </p>
              <GuideBullets
                items={[
                  'New Chat creates a fresh Remote Codex thread with its own workspace',
                  'Interrupt, compact, goal controls, and model controls remain in the composer',
                  'Shell view stays available when a shell adapter is attached',
                ]}
              />
            </div>
          </div>
        </GuideAccordionItem>

        <GuideAccordionItem
          value="remote-codex"
          title="Remote Codex Extras"
          icon={<Code2 className="h-3 w-3" />}
        >
          <GuideBullets
            items={[
              'Slash toolbox: skills, MCP, hooks, goals, forks, model controls, provider settings',
              'Rich message bubbles: reasoning, commands, searches, file reads, file changes, plans, action requests, artifacts',
              'Plugin surfaces: terminal, XYZ molecule viewer, inline code renderers, and imported plugin panels',
              'Thread metadata stays in the left rail and Workspace tab instead of replacing chat',
            ]}
          />
        </GuideAccordionItem>
        </Accordion>
      </div>
    </div>
  );
}
