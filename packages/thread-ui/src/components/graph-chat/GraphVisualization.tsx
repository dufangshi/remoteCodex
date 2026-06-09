import { useCallback, useEffect, useMemo } from 'react';
import {
  addEdge,
  Background,
  Controls,
  type Edge,
  Handle,
  MarkerType,
  type Node,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import { FloatingConnectionLine } from './FloatingConnectionLine';
import { FloatingEdge } from './FloatingEdge';
import { buildGraph, type GraphChatInputNode } from './FloatingHelper';

type GraphChatFlowNode = Node<{ label: React.ReactNode }, 'styledNode'>;
type GraphChatFlowEdge = Edge;

interface GraphVisualizationProps {
  nodes: GraphChatInputNode[];
}

export function GraphVisualization({ nodes: inputNodes }: GraphVisualizationProps) {
  const [flowNodes, setFlowNodes, onNodesChange] =
    useNodesState<GraphChatFlowNode>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] =
    useEdgesState<GraphChatFlowEdge>([]);
  const graph = useMemo(() => buildGraph(inputNodes), [inputNodes]);
  const edgeTypes = useMemo(() => ({ floating: FloatingEdge }), []);
  const nodeTypes = useMemo(
    () => ({
      styledNode: ({ data, isConnectable }: any) => (
        <div className="thread-graph-flow-node">
          {data.label}
          <Handle
            type="target"
            position={Position.Top}
            isConnectable={isConnectable}
            style={{ opacity: 0, pointerEvents: 'none' }}
          />
          <Handle
            type="source"
            position={Position.Bottom}
            isConnectable={isConnectable}
            style={{ opacity: 0, pointerEvents: 'none' }}
          />
        </div>
      ),
    }),
    [],
  );

  useEffect(() => {
    setFlowNodes(graph.nodes as GraphChatFlowNode[]);
    setFlowEdges(graph.edges as GraphChatFlowEdge[]);
  }, [graph.edges, graph.nodes, setFlowEdges, setFlowNodes]);

  const onConnect = useCallback(
    (params: any) =>
      setFlowEdges((edges) =>
        addEdge(
          {
            ...params,
            type: 'floating',
            sourceHandle: null,
            targetHandle: null,
            markerEnd: { type: MarkerType.Arrow },
          },
          edges,
        ),
      ),
    [setFlowEdges],
  );

  return (
    <div className="thread-graph-flow h-full min-h-0">
      <ReactFlowProvider>
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          fitView
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={FloatingConnectionLine}
        >
          <Controls />
          <Background gap={16} />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
