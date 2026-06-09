import {
  AlignVerticalDistributeCenter,
  ArrowUpRight,
  Box,
  Boxes,
  Bubbles,
  Camera,
  CircleX,
  Copy,
  Download,
  Eraser,
  Rotate3d,
  RotateCcw,
  Send,
  Share2,
  Spline,
  Trash2,
  Waypoints,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { GLViewer } from '3dmol';
import type { ReactNode, RefObject } from 'react';
import { Button } from '../graph-ui/Button';
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from '../graph-ui/ButtonGroup';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../graph-ui/Tooltip';

export type GraphMoleculeCameraInfo = {
  position: {
    x: number;
    y: number;
    z: number;
    qx: number;
    qy: number;
    qz: number;
    qw: number;
  };
  lookAt: { x: number; y: number; z: number };
  zoom: number;
};

function moleculeSlug(value: string | null | undefined) {
  const normalized = value
    ?.trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'molecule';
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function GraphMoleculeIconButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="thread-graph-molecule-button size-8"
          disabled={disabled}
          onClick={onClick}
          title={label}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        <p>{label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

export function GraphMoleculeButtonGroup({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <ButtonGroup className={`thread-graph-molecule-button-group ${className}`}>
      {children}
    </ButtonGroup>
  );
}

export function GraphMoleculeViewerUpperButtonGroup({
  currentIndex,
  exportContent,
  moleculeId,
  onScreenshot,
  viewerRef,
  xyzContent,
  xyzFormat,
}: {
  currentIndex: number;
  exportContent: string;
  moleculeId?: string | null;
  onScreenshot: () => void;
  viewerRef: RefObject<GLViewer | null>;
  xyzContent: string | null;
  xyzFormat: string;
}) {
  const slug = moleculeSlug(moleculeId);

  async function handleCopy() {
    if (!xyzContent) {
      return;
    }
    await navigator.clipboard.writeText(xyzContent);
  }

  function handleDownloadCurrent() {
    if (!xyzContent) {
      return;
    }
    downloadTextFile(
      xyzContent,
      `${slug}_step_${currentIndex + 1}.${xyzFormat || 'xyz'}`,
    );
  }

  function handleDownloadAll() {
    if (!exportContent) {
      return;
    }
    downloadTextFile(exportContent, `${slug}_trajectory.${xyzFormat || 'xyz'}`);
  }

  function handleZoom(factor: number) {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    viewer.zoom(factor);
    viewer.render();
  }

  function handleReset() {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }
    viewer.zoomTo();
    viewer.setCameraParameters({});
    viewer.render();
  }

  return (
    <GraphMoleculeButtonGroup className="ml-auto justify-end">
      <GraphMoleculeIconButton
        label="Copy current structure"
        onClick={() => void handleCopy()}
        disabled={!xyzContent}
      >
        <Copy className="size-3.5" />
      </GraphMoleculeIconButton>
      <GraphMoleculeIconButton
        label="Download current structure"
        onClick={handleDownloadCurrent}
        disabled={!xyzContent}
      >
        <Download className="size-3.5" />
      </GraphMoleculeIconButton>
      <GraphMoleculeIconButton
        label="Download full trajectory"
        onClick={handleDownloadAll}
        disabled={!exportContent}
      >
        <Box className="size-3.5" />
      </GraphMoleculeIconButton>
      <GraphMoleculeIconButton
        label="Copy screenshot"
        onClick={onScreenshot}
        disabled={!viewerRef.current || !xyzContent}
      >
        <Camera className="size-3.5" />
      </GraphMoleculeIconButton>
      <ButtonGroupSeparator className="thread-graph-molecule-button-divider" />
      <GraphMoleculeIconButton
        label="Zoom in"
        onClick={() => handleZoom(1.2)}
        disabled={!viewerRef.current || !xyzContent}
      >
        <ZoomIn className="size-3.5" />
      </GraphMoleculeIconButton>
      <GraphMoleculeIconButton
        label="Zoom out"
        onClick={() => handleZoom(0.8)}
        disabled={!viewerRef.current || !xyzContent}
      >
        <ZoomOut className="size-3.5" />
      </GraphMoleculeIconButton>
      <GraphMoleculeIconButton
        label="Reset camera"
        onClick={handleReset}
        disabled={!viewerRef.current || !xyzContent}
      >
        <RotateCcw className="size-3.5" />
      </GraphMoleculeIconButton>
    </GraphMoleculeButtonGroup>
  );
}

export function GraphMoleculeViewerLowerButtonGroup({
  cameraInfo,
  onClearSelection,
  onClearStaged,
  onSendSelection,
  onSendStaged,
  onStageSelection,
  onToggleUnitCell,
  selectedAtomLabels,
  selectedSerials,
  stagedAtoms,
  stagedMolecules,
  unitCellAvailable,
  unitCellVisible,
}: {
  cameraInfo: GraphMoleculeCameraInfo | null;
  onClearSelection: () => void;
  onClearStaged: () => void;
  onSendSelection: () => void;
  onSendStaged: () => void;
  onStageSelection: () => void;
  onToggleUnitCell: () => void;
  selectedAtomLabels: Record<number, string>;
  selectedSerials: number[];
  stagedAtoms: number;
  stagedMolecules: number;
  unitCellAvailable: boolean;
  unitCellVisible: boolean;
}) {
  const hasSelection = selectedSerials.length > 0;
  const hasStaged = stagedAtoms > 0;

  return (
    <>
      <div className="flex w-full justify-between gap-2 overflow-x-auto">
        <GraphMoleculeButtonGroup>
          <GraphMoleculeIconButton label="Distance">
            <AlignVerticalDistributeCenter className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton label="Connectivity">
            <Share2 className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton label="Angle">
            <Waypoints className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton label="Dihedral">
            <Spline className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton label="Add dummy atoms">
            <Bubbles className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton label="Delete atoms">
            <CircleX className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton label="Rotate">
            <Rotate3d className="size-4" />
          </GraphMoleculeIconButton>
        </GraphMoleculeButtonGroup>

        <GraphMoleculeButtonGroup>
          <GraphMoleculeIconButton
            label={unitCellVisible ? 'Hide unit cell' : 'Show unit cell'}
            disabled={!unitCellAvailable}
            onClick={onToggleUnitCell}
          >
            <Boxes className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton
            label="Clear selection"
            disabled={!hasSelection}
            onClick={onClearSelection}
          >
            <Trash2 className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton
            label="Send selection"
            disabled={!hasSelection}
            onClick={onSendSelection}
          >
            <Send className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton
            label="Stage current selection"
            disabled={!hasSelection}
            onClick={onStageSelection}
          >
            <Box className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton
            label="Clear staged selections"
            disabled={!hasStaged}
            onClick={onClearStaged}
          >
            <Eraser className="size-4" />
          </GraphMoleculeIconButton>
          <GraphMoleculeIconButton
            label="Send staged selections"
            disabled={!hasStaged}
            onClick={onSendStaged}
          >
            <ArrowUpRight className="size-4" />
          </GraphMoleculeIconButton>
        </GraphMoleculeButtonGroup>
      </div>

      {cameraInfo ? (
        <div className="thread-graph-molecule-camera">
          <div>
            <strong>XYZ: </strong>x={cameraInfo.position.x.toFixed(1)} y=
            {cameraInfo.position.y.toFixed(1)} z=
            {cameraInfo.position.z.toFixed(1)}
            <br />
            <strong>Quat: </strong>qx=
            {cameraInfo.position.qx.toFixed(2)} qy=
            {cameraInfo.position.qy.toFixed(2)} qz=
            {cameraInfo.position.qz.toFixed(2)} qw=
            {cameraInfo.position.qw.toFixed(2)}
          </div>
          <div className="thread-graph-molecule-camera-divider" />
          <div className="flex flex-col gap-1 text-[10px]">
            <div>
              Selected atoms:{' '}
              {selectedSerials.length > 0
                ? selectedSerials
                    .map(
                      (serial) =>
                        `${
                          selectedAtomLabels[serial] ?? 'Atom'
                        }(${serial})`,
                    )
                    .join(', ')
                : 'None'}
            </div>
            <div>
              Staged: {stagedMolecules} molecule(s), {stagedAtoms} atom(s)
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
