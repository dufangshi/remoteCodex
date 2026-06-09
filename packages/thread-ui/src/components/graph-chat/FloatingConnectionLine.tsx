import type { ConnectionLineComponentProps } from '@xyflow/react';
import { getBezierPath, Position } from '@xyflow/react';

import { getEdgeParams } from './FloatingHelper';

export function FloatingConnectionLine({
  toX,
  toY,
  fromPosition,
  toPosition,
  fromNode,
}: ConnectionLineComponentProps) {
  if (!fromNode) {
    return null;
  }

  const targetNode = {
    id: 'connection-target',
    measured: {
      width: 1,
      height: 1,
    },
    internals: {
      positionAbsolute: { x: toX, y: toY },
    },
  };

  const { sx, sy, tx, ty, sourcePos, targetPos } = getEdgeParams(
    fromNode,
    targetNode,
  );

  const [edgePath] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: (sourcePos as Position) || fromPosition,
    targetPosition: (targetPos as Position) || toPosition,
    targetX: tx || toX,
    targetY: ty || toY,
  });

  return (
    <g>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        className="animated"
        d={edgePath}
      />
      <circle
        cx={tx || toX}
        cy={ty || toY}
        fill="var(--theme-panel)"
        r={3}
        stroke="currentColor"
        strokeWidth={1.5}
      />
    </g>
  );
}
