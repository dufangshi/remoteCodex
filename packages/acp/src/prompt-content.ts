import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type * as acp from '@agentclientprotocol/sdk';
import type { AgentPromptContentBlock } from '../../agent-runtime/src/types';
import { resolveAcpWorkspacePath } from './workspace-boundary';

const attachmentTokenPattern = /\[(PHOTO|FILE)\s+([^\]]+)\]/g;
const maxEmbeddedImageBytes = 20 * 1024 * 1024;

function imageMimeType(filePath: string) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.png':
    default:
      return 'image/png';
  }
}

export async function buildAcpPromptContent(input: {
  prompt: string;
  workspacePath: string;
  promptCapabilities: acp.PromptCapabilities | null | undefined;
  content?: AgentPromptContentBlock[];
}): Promise<acp.ContentBlock[]> {
  if (input.content) {
    return input.content.map((block) => {
      if (block.type === 'audio' && input.promptCapabilities?.audio !== true) {
        throw new Error('The selected ACP agent does not support audio prompts.');
      }
      if (block.type === 'resource' && input.promptCapabilities?.embeddedContext !== true) {
        throw new Error('The selected ACP agent does not support embedded context.');
      }
      return structuredClone(block) as acp.ContentBlock;
    });
  }
  const matches = [...input.prompt.matchAll(attachmentTokenPattern)];
  if (matches.length === 0) {
    return [{ type: 'text', text: input.prompt }];
  }

  const blocks: acp.ContentBlock[] = [];
  let cursor = 0;
  for (const match of matches) {
    const start = match.index ?? 0;
    const preceding = input.prompt.slice(cursor, start);
    if (preceding) {
      blocks.push({ type: 'text', text: preceding });
    }
    const kind = match[1];
    const requestedPath = match[2]?.trim() ?? '';
    const requestedAssetPath = path.isAbsolute(requestedPath)
      ? requestedPath
      : path.resolve(input.workspacePath, requestedPath);
    const assetPath = await resolveAcpWorkspacePath(
      input.workspacePath,
      requestedAssetPath,
    );
    const uri = pathToFileURL(assetPath).toString();
    if (kind === 'PHOTO') {
      const stat = await fs.stat(assetPath);
      if (!stat.isFile() || stat.size > maxEmbeddedImageBytes) {
        throw new Error('ACP image attachment is missing or exceeds 20 MiB.');
      }
      blocks.push({
        type: 'image',
        data: (await fs.readFile(assetPath)).toString('base64'),
        mimeType: imageMimeType(assetPath),
        uri,
      });
    } else {
      await fs.access(assetPath);
      blocks.push({
        type: 'resource_link',
        name: path.basename(assetPath),
        uri,
      });
    }
    cursor = start + match[0].length;
  }
  const trailing = input.prompt.slice(cursor);
  if (trailing) {
    blocks.push({ type: 'text', text: trailing });
  }
  return blocks;
}
