import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const base = `http://127.0.0.1:${process.env.E2E_API_PORT ?? 8787}`;
const flowchart = `flowchart TD
  A["用户 / AI 助手"] --> B["文本或 LaTeX"]
  B --> C["Python 客户端<br/>字符预检 · 排版"]
  C --> D["异步手写生成<br/>模型推理"]
  D --> E["原始墨迹与布局"]
  E --> F["PNG / WebP / PDF"]`;

test('chat renders Mermaid with Chinese labels, source fallback and zoom without overflowing', async ({ page, request }, testInfo) => {
  const absPath = path.resolve(process.env.E2E_WORKSPACE_ROOT!, randomUUID());
  await mkdir(absPath, { recursive: true });
  const workspace = await (await request.post(`${base}/api/workspaces`, { data: { absPath, label: 'Mermaid diagrams' } })).json();
  const start = await request.post(`${base}/api/threads/start`, { data: { workspaceId: workspace.id, title: '图表渲染预览', provider: 'acp', agentId: 'codex', model: 'ios-e2e-stream', approvalMode: 'yolo' } });
  expect(start.ok()).toBeTruthy();
  const value = await start.json();
  const id = value.id ?? value.thread.id;
  const turnId = randomUUID();
  const now = new Date().toISOString();
  const text = [
    '### 手写生成流程\n\n聊天中的流程图现在可以直接查看。',
    `\`\`\`\n${flowchart}\n\`\`\``,
    '### Agent 协作时序',
    '```mermaid\nsequenceDiagram\n  participant U as 用户\n  participant A as 主 Agent\n  participant B as 子线程\n  U->>A: 开始任务\n  A->>B: 分配工作\n  B-->>A: 交付结果\n  A-->>U: 汇报\n```',
    '### 普通代码保持不变\n\n```python\nprint("flowchart TD")\n```',
    '### 语法错误时保留源码\n\n```mermaid\nflowchart TD\nA[\n```',
    '### Diagram directives cannot enable active content',
    '```mermaid\n%%{init: {"securityLevel": "loose", "htmlLabels": true}}%%\nflowchart LR\nA["Safe text"]-->B["Done"]\nclick A "javascript:alert(1)"\n```',
  ].join('\n\n');
  const database = path.resolve(process.env.E2E_DATABASE_URL!);
  expect(database).toContain('.temp/workbench/');
  const db = new DatabaseSync(database);
  db.function('search_fold', { deterministic: true }, value => typeof value === 'string' ? value.toLowerCase() : value);
  db.function('search_body', { deterministic: true }, (text, kind, _source) => ['userMessage', 'agentMessage'].includes(String(kind)) ? text : null);
  try {
    db.prepare('INSERT INTO thread_turns(id,thread_id,status,started_at,completed_at,ordinal,display_prompt) VALUES (?,?,?,?,?,?,?)').run(turnId, id, 'completed', now, now, 0, '展示流程图');
    for (const item of [{ id: `${turnId}-user`, kind: 'userMessage', text: '展示流程图' }, { id: `${turnId}-reply`, kind: 'agentMessage', text }]) {
      db.prepare('INSERT INTO thread_history_items(id,thread_id,turn_id,item_id,item_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(randomUUID(), id, turnId, item.id, JSON.stringify({ ...item, createdAt: now, status: 'completed' }), now, now);
    }
  } finally { db.close(); }
  await page.addInitScript(() => localStorage.setItem('remote-codex-theme-mode', 'dark'));
  await page.goto(`/threads/${id}`);
  const diagrams = page.locator('.thread-graph-mermaid');
  await expect(diagrams).toHaveCount(4);
  const flow = diagrams.nth(0);
  await expect(flow).toHaveAttribute('data-state', 'ready');
  await expect(flow.locator('.thread-graph-mermaid-canvas > svg')).toBeVisible();
  await expect(flow.locator('.thread-graph-mermaid-canvas')).toContainText('Python 客户端');
  await expect(flow.locator('foreignObject')).toHaveCount(0);
  expect(await flow.locator('.thread-graph-mermaid-canvas > svg').evaluate(svg => svg.getBoundingClientRect().width)).toBeLessThanOrEqual(await flow.evaluate(e => e.clientWidth));
  await flow.screenshot({ path: testInfo.outputPath('flowchart-dark.png') });
  await flow.getByRole('button', { name: 'View diagram source', exact: true }).click();
  await expect(flow.locator('code')).toHaveText(flowchart);
  await flow.getByRole('button', { name: 'Show diagram', exact: true }).click();
  await flow.getByRole('button', { name: 'Expand diagram', exact: true }).click();
  const lightbox = page.getByRole('dialog', { name: 'Image preview: Diagram', exact: true });
  await expect(lightbox).toBeVisible();
  await expect(lightbox.locator('img')).toBeVisible();
  await lightbox.locator('img').evaluate(async image => { await (image as HTMLImageElement).decode(); });
  await page.screenshot({ path: testInfo.outputPath('flowchart-expanded.png') });
  await lightbox.getByRole('button', { name: 'Zoom in', exact: true }).click();
  await expect(lightbox.getByRole('button', { name: /Reset zoom/ })).toContainText('125%');
  await lightbox.getByRole('button', { name: 'Close image preview', exact: true }).click();
  await expect(flow.getByRole('button', { name: 'Expand diagram', exact: true })).toBeFocused();
  await diagrams.nth(1).scrollIntoViewIfNeeded();
  await expect(diagrams.nth(1)).toHaveAttribute('data-state', 'ready');
  await expect(diagrams.nth(1)).toContainText('交付结果');
  await expect(page.locator('.thread-graph-code-block')).toContainText('print("flowchart TD")');
  await diagrams.nth(2).scrollIntoViewIfNeeded();
  await expect(diagrams.nth(2)).toHaveAttribute('data-state', 'error');
  await expect(diagrams.nth(2).locator('code')).toHaveText('flowchart TD\nA[');
  await diagrams.nth(3).scrollIntoViewIfNeeded();
  await expect(diagrams.nth(3)).toHaveAttribute('data-state', 'ready');
  await expect(diagrams.nth(3).locator('a[*|href], script, foreignObject, [onclick]')).toHaveCount(0);
  await expect(page.locator('body > [id^="dthread-mermaid-"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  // Match the existing shell's theme signal; verify this same SVG is regenerated.
  const oldSvg = await flow.locator('.thread-graph-mermaid-canvas > svg').getAttribute('id');
  await page.locator('.thread-ui-shell').evaluate(shell => {
    shell.classList.remove('dark', 'thread-ui-theme-dark');
    shell.setAttribute('data-theme-effective', 'light');
  });
  await flow.scrollIntoViewIfNeeded();
  await expect(flow).toHaveAttribute('data-theme', 'light');
  await expect(flow).toHaveAttribute('data-state', 'ready');
  expect(await flow.locator('.thread-graph-mermaid-canvas > svg').getAttribute('id')).not.toBe(oldSvg);
});
