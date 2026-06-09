export type GraphMoleculeViewerSnapshot = {
  content: string[];
  format?: string | null;
  uuid?: string | null;
  name?: string | null;
};

export type GraphMoleculeViewerSource =
  | GraphMoleculeViewerSnapshot
  | string
  | null
  | undefined;

export type GraphMoleculeViewerData = {
  format: string;
  frames: string[];
  exportContent: string;
};

function normalizeFormat(format: string | null | undefined): string {
  const normalized = format?.trim().toLowerCase();
  if (!normalized || normalized === 'extxyz') {
    return 'xyz';
  }
  return normalized;
}

function splitXyzTrajectory(content: string): string[] {
  const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const frames: string[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    while (cursor < lines.length && lines[cursor]?.trim() === '') {
      cursor += 1;
    }
    if (cursor >= lines.length) {
      break;
    }

    const atomCount = Number.parseInt(lines[cursor]?.trim() ?? '', 10);
    if (!Number.isFinite(atomCount) || atomCount < 0) {
      return [content];
    }

    const frameLineCount = atomCount + 2;
    if (cursor + frameLineCount > lines.length) {
      return [content];
    }

    frames.push(`${lines.slice(cursor, cursor + frameLineCount).join('\n')}\n`);
    cursor += frameLineCount;
  }

  return frames.length > 0 ? frames : [content];
}

function normalizeSnapshotFrames(content: string[], format: string): string[] {
  if (format !== 'xyz') {
    return content;
  }
  return content.flatMap((frame) => splitXyzTrajectory(frame));
}

function joinFramesForExport(content: string[]): string {
  return content.map((frame) => `${frame.replace(/\s+$/g, '')}\n`).join('');
}

export function readGraphMoleculeViewerData(
  source: GraphMoleculeViewerSource,
): GraphMoleculeViewerData {
  if (!source) {
    return {
      format: 'xyz',
      frames: [],
      exportContent: '',
    };
  }

  if (typeof source === 'string') {
    const frames = normalizeSnapshotFrames([source], 'xyz');
    return {
      frames,
      format: 'xyz',
      exportContent: joinFramesForExport(frames),
    };
  }

  const format = normalizeFormat(source.format);
  const content = source.content.filter((frame) => frame.trim().length > 0);
  const frames = normalizeSnapshotFrames(content, format);

  return {
    frames,
    format,
    exportContent: joinFramesForExport(content),
  };
}
