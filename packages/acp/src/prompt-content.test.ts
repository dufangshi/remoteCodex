import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildAcpPromptContent } from './prompt-content';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) =>
    fs.rm(directory, { recursive: true, force: true })));
});

describe('ACP prompt content', () => {
  it('maps workspace photos and files into typed ACP blocks', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-acp-prompt-'));
    directories.push(workspace);
    await fs.writeFile(path.join(workspace, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    await fs.writeFile(path.join(workspace, 'notes.txt'), 'fixture notes');

    const blocks = await buildAcpPromptContent({
      prompt: 'Inspect [PHOTO ./pixel.png] and [FILE ./notes.txt] now.',
      workspacePath: workspace,
      promptCapabilities: {},
    });

    expect(blocks).toMatchObject([
      { type: 'text', text: 'Inspect ' },
      { type: 'image', mimeType: 'image/png', data: 'iVBORw==' },
      { type: 'text', text: ' and ' },
      { type: 'resource_link', name: 'notes.txt' },
      { type: 'text', text: ' now.' },
    ]);
  });

  it('passes images through regardless of the advertised capability', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-acp-prompt-'));
    directories.push(workspace);
    await fs.writeFile(path.join(workspace, 'pixel.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));

    await expect(buildAcpPromptContent({
      prompt: '[PHOTO ./pixel.png]',
      workspacePath: workspace,
      promptCapabilities: { image: false },
    })).resolves.toMatchObject([{ type: 'image', data: 'iVBORw==' }]);
    await expect(buildAcpPromptContent({
      prompt: '',
      workspacePath: workspace,
      promptCapabilities: {},
      content: [{ type: 'image', data: 'iVBORw==', mimeType: 'image/png' }],
    })).resolves.toMatchObject([{ type: 'image', data: 'iVBORw==' }]);
  });

  it('rejects attachment paths outside the workspace', async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'remote-codex-acp-prompt-'));
    directories.push(workspace);
    await expect(buildAcpPromptContent({
      prompt: '[FILE ../outside.txt]',
      workspacePath: workspace,
      promptCapabilities: {},
    })).rejects.toThrow(/must stay inside the session workspace/);
  });

  it('validates audio, embedded resources, and baseline resource links', async () => {
    const blocks = await buildAcpPromptContent({
      prompt: '',
      workspacePath: process.cwd(),
      promptCapabilities: { audio: true, embeddedContext: true },
      content: [
        { type: 'audio', data: 'YXVkaW8=', mimeType: 'audio/wav' },
        {
          type: 'resource',
          resource: { uri: 'file:///workspace/context.txt', text: 'Context' },
        },
        { type: 'resource_link', name: 'Docs', uri: 'https://example.test/docs' },
      ],
    });
    expect(blocks).toMatchObject([
      { type: 'audio', mimeType: 'audio/wav' },
      { type: 'resource', resource: { text: 'Context' } },
      { type: 'resource_link', name: 'Docs' },
    ]);
    await expect(buildAcpPromptContent({
      prompt: '',
      workspacePath: process.cwd(),
      promptCapabilities: {},
      content: [{ type: 'audio', data: 'YXVkaW8=', mimeType: 'audio/wav' }],
    })).rejects.toThrow(/does not support audio prompts/);
    await expect(buildAcpPromptContent({
      prompt: '',
      workspacePath: process.cwd(),
      promptCapabilities: {},
      content: [{
        type: 'resource',
        resource: { uri: 'file:///workspace/context.txt', text: 'Context' },
      }],
    })).rejects.toThrow(/does not support embedded context/);
  });
});
