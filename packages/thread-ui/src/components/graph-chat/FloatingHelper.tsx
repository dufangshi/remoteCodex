import { MarkerType, Position } from '@xyflow/react';
import type { ReactNode } from 'react';

export type GraphChatInputNode = {
  id: string;
  name: string;
  description?: string;
  out_node_id?: string | string[];
};

function getNodeIntersection(intersectionNode: any, targetNode: any) {
  const { width: intersectionNodeWidth, height: intersectionNodeHeight } =
    intersectionNode.measured;
  const intersectionNodePosition = intersectionNode.internals.positionAbsolute;
  const targetPosition = targetNode.internals.positionAbsolute;

  const w = intersectionNodeWidth / 2;
  const h = intersectionNodeHeight / 2;

  const x2 = intersectionNodePosition.x + w;
  const y2 = intersectionNodePosition.y + h;
  const x1 = targetPosition.x + targetNode.measured.width / 2;
  const y1 = targetPosition.y + targetNode.measured.height / 2;

  const xx1 = (x1 - x2) / (2 * w) - (y1 - y2) / (2 * h);
  const yy1 = (x1 - x2) / (2 * w) + (y1 - y2) / (2 * h);
  const a = 1 / (Math.abs(xx1) + Math.abs(yy1));
  const xx3 = a * xx1;
  const yy3 = a * yy1;
  const x = w * (xx3 + yy3) + x2;
  const y = h * (-xx3 + yy3) + y2;

  return { x, y };
}

function getEdgePosition(node: any, intersectionPoint: { x: number; y: number }) {
  const n = { ...node.internals.positionAbsolute, ...node };
  const nx = Math.round(n.x);
  const ny = Math.round(n.y);
  const px = Math.round(intersectionPoint.x);
  const py = Math.round(intersectionPoint.y);

  if (px <= nx + 1) {
    return Position.Left;
  }
  if (px >= nx + n.measured.width - 1) {
    return Position.Right;
  }
  if (py <= ny + 1) {
    return Position.Top;
  }
  if (py >= n.y + n.measured.height - 1) {
    return Position.Bottom;
  }

  return Position.Top;
}

export function getEdgeParams(source: any, target: any) {
  const sourceIntersectionPoint = getNodeIntersection(source, target);
  const targetIntersectionPoint = getNodeIntersection(target, source);

  const sourcePos = getEdgePosition(source, sourceIntersectionPoint);
  const targetPos = getEdgePosition(target, targetIntersectionPoint);

  return {
    sx: sourceIntersectionPoint.x,
    sy: sourceIntersectionPoint.y,
    tx: targetIntersectionPoint.x,
    ty: targetIntersectionPoint.y,
    sourcePos,
    targetPos,
  };
}

export function buildGraph(
  inputNodes: GraphChatInputNode[],
  width = 900,
  height = 620,
) {
  if (!inputNodes || !Array.isArray(inputNodes)) {
    return { nodes: [], edges: [] };
  }

  const forceLayout = (
    nodes: GraphChatInputNode[],
    edges: Array<{ source: string; target: string }>,
    layoutWidth: number,
    layoutHeight: number,
  ) => {
    const nodePositions = new Map<
      string,
      { x: number; y: number; vx: number; vy: number }
    >();
    const nodeCount = nodes.length;

    nodes.forEach((node, index) => {
      const hash = node.id.split('').reduce((value, character) => {
        const nextValue = (value << 5) - value + character.charCodeAt(0);
        return nextValue & nextValue;
      }, 0);

      nodePositions.set(node.id, {
        x: (Math.abs(hash) % layoutWidth) + ((index * 100) % layoutWidth),
        y:
          (Math.abs(hash >> 16) % layoutHeight) +
          ((index * 150) % layoutHeight),
        vx: 0,
        vy: 0,
      });
    });

    for (let iteration = 0; iteration < 200; iteration += 1) {
      for (let i = 0; i < nodeCount; i += 1) {
        for (let j = i + 1; j < nodeCount; j += 1) {
          const firstNode = nodes[i];
          const secondNode = nodes[j];
          if (!firstNode || !secondNode) {
            continue;
          }
          const pos1 = nodePositions.get(firstNode.id);
          const pos2 = nodePositions.get(secondNode.id);
          if (!pos1 || !pos2) {
            continue;
          }

          const dx = pos1.x - pos2.x;
          const dy = pos1.y - pos2.y;
          const distance = Math.sqrt(dx * dx + dy * dy) || 1;
          const optimalDistance = 200;
          const force = (optimalDistance - distance) * 0.5;
          const fx = (dx / distance) * force;
          const fy = (dy / distance) * force;

          pos1.vx += fx;
          pos1.vy += fy;
          pos2.vx -= fx;
          pos2.vy -= fy;
        }
      }

      edges.forEach((edge) => {
        const pos1 = nodePositions.get(edge.source);
        const pos2 = nodePositions.get(edge.target);
        if (!pos1 || !pos2) {
          return;
        }

        const dx = pos2.x - pos1.x;
        const dy = pos2.y - pos1.y;
        const distance = Math.sqrt(dx * dx + dy * dy) || 1;
        const targetLength = 120;
        const springForce = (distance - targetLength) * 0.3;
        const fx = (dx / distance) * springForce;
        const fy = (dy / distance) * springForce;

        pos1.vx += fx;
        pos1.vy += fy;
        pos2.vx -= fx;
        pos2.vy -= fy;
      });

      nodePositions.forEach((position) => {
        position.x += position.vx * 0.1;
        position.y += position.vy * 0.1;
        position.vx *= 0.9;
        position.vy *= 0.9;
        position.x = Math.max(80, Math.min(layoutWidth - 80, position.x));
        position.y = Math.max(80, Math.min(layoutHeight - 80, position.y));
      });
    }

    return nodePositions;
  };

  const inputIds = new Set(inputNodes.map((node) => node.id));
  const edges: Array<{
    id: string;
    source: string;
    target: string;
    type: string;
    sourceHandle: null;
    targetHandle: null;
    markerEnd: { type: MarkerType };
  }> = [];

  inputNodes.forEach((node) => {
    if (!node.out_node_id) {
      return;
    }
    const outNodes = Array.isArray(node.out_node_id)
      ? node.out_node_id
      : [node.out_node_id];
    outNodes.forEach((outNodeId) => {
      if (!inputIds.has(outNodeId)) {
        return;
      }
      edges.push({
        id: `${node.id}-${outNodeId}`,
        source: node.id,
        target: outNodeId,
        type: 'floating',
        sourceHandle: null,
        targetHandle: null,
        markerEnd: { type: MarkerType.Arrow },
      });
    });
  });

  const positions = forceLayout(inputNodes, edges, width, height);
  const nodes = inputNodes.map((node) => ({
    id: node.id,
    type: 'styledNode',
    position: positions.get(node.id) ?? { x: 100, y: 100 },
    data: {
      label: (
        <div className="text-center">
          <div className="text-sm font-semibold">{node.name}</div>
          {node.description ? (
            <div className="mt-1 max-w-32 overflow-hidden text-ellipsis text-xs text-slate-500 dark:text-slate-400">
              {node.description}
            </div>
          ) : null}
        </div>
      ) as ReactNode,
    },
  }));

  return { nodes, edges };
}
