import {
  Pause,
  Play,
  RotateCcw,
  Camera,
  Copy,
  Download,
  Box,
  Boxes,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  readMoleculeViewerData,
  type MoleculeViewerSource,
} from './moleculeViewerData';
import { load3Dmol, type GLModel, type GLViewer } from './load3Dmol';

type ThreeDmolAtom = {
  atom?: string;
  elem?: string;
  index?: number;
  serial?: number;
  x: number;
  y: number;
  z: number;
};

export interface MoleculeScreenshot {
  moleculeId: string | null;
  image: string;
}

export interface MoleculeAtomSelection {
  moleculeId: string | null;
  atoms: number[];
}

export interface XyzMoleculeViewerProps {
  source: MoleculeViewerSource;
  moleculeId?: string | null;
  title?: string | null;
  className?: string;
  onScreenshot?: (screenshot: MoleculeScreenshot) => void;
  onSelectionChange?: (selection: MoleculeAtomSelection) => void;
}

type HoveredAtom = {
  x: number;
  y: number;
  label: string;
  coords: {
    x: string;
    y: string;
    z: string;
  };
};

type CameraInfo = {
  x: number;
  y: number;
  z: number;
  zoom: number;
  qx: number;
  qy: number;
  qz: number;
  qw: number;
};

function hasWebGLSupport() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl2') ||
        canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
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

function moleculeSlug(value: string | null | undefined) {
  const normalized = value
    ?.trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'molecule';
}

export function XyzMoleculeViewer({
  source,
  moleculeId = null,
  title = 'Molecule Viewer',
  className = '',
  onScreenshot,
  onSelectionChange,
}: XyzMoleculeViewerProps) {
  const viewerHostRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const modelRef = useRef<GLModel | null>(null);
  const zoomedRef = useRef(false);
  const unitCellPreferenceRef = useRef(true);

  const [viewerInitError, setViewerInitError] = useState<string | null>(null);
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedSerials, setSelectedSerials] = useState<number[]>([]);
  const [atomLabels, setAtomLabels] = useState<string[]>([]);
  const [hoveredAtom, setHoveredAtom] = useState<HoveredAtom | null>(null);
  const [cameraInfo, setCameraInfo] = useState<CameraInfo | null>(null);
  const [unitCellVisible, setUnitCellVisible] = useState(false);
  const [unitCellAvailable, setUnitCellAvailable] = useState(false);

  const viewerData = useMemo(() => readMoleculeViewerData(source), [source]);
  const frames = viewerData.frames;
  const currentFrame = frames[currentFrameIndex] ?? '';
  const currentSlug = moleculeSlug(moleculeId);
  const isLive = frames.length > 0 && currentFrameIndex === frames.length - 1;

  useEffect(() => {
    if (frames.length === 0) {
      setCurrentFrameIndex(0);
      return;
    }

    setCurrentFrameIndex(frames.length - 1);
  }, [frames.length]);

  useEffect(() => {
    if (!isPlaying || frames.length <= 1) {
      return;
    }

    const interval = window.setInterval(() => {
      setCurrentFrameIndex((previous) => {
        if (previous >= frames.length - 1) {
          window.clearInterval(interval);
          setIsPlaying(false);
          return previous;
        }
        return previous + 1;
      });
    }, 200);

    return () => window.clearInterval(interval);
  }, [frames.length, isPlaying]);

  useEffect(() => {
    const host = viewerHostRef.current;
    if (!host || viewerRef.current) {
      return;
    }

    let cancelled = false;

    if (!hasWebGLSupport()) {
      setViewerInitError(
        'WebGL is unavailable in this browser environment. Unable to render the 3D viewer.',
      );
      return;
    }

    const resizeViewer = () => {
      viewerRef.current?.resize();
      viewerRef.current?.render();
    };

    load3Dmol()
      .then(($3Dmol) => {
        if (cancelled || viewerRef.current) {
          return;
        }

        try {
          const viewer = $3Dmol.createViewer(host, {});
          viewerRef.current = viewer;
          viewer.setBackgroundColor('#fbfbfb', 1);
          window.addEventListener('resize', resizeViewer);
          window.setTimeout(resizeViewer, 100);
        } catch (error) {
          console.error('Failed to initialize 3Dmol viewer:', error);
          setViewerInitError('Failed to initialize the 3D molecule viewer.');
        }
      })
      .catch((error: unknown) => {
        console.error('Failed to load 3Dmol viewer runtime:', error);
        setViewerInitError('Failed to load the 3D molecule viewer runtime.');
      });

    return () => {
      cancelled = true;
      window.removeEventListener('resize', resizeViewer);
      viewerRef.current = null;
      modelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !currentFrame) {
      return;
    }

    try {
      viewer.removeAllModels();
      viewer.removeAllShapes();
      viewer.removeAllLabels();

      const model = viewer.addModel(currentFrame, viewerData.format);
      modelRef.current = model;
      model.setStyle({}, { stick: { radius: 0.2 }, sphere: { scale: 0.3 } });

      const crystalData = model.getCrystData();
      const hasUnitCell = Boolean(
        crystalData &&
          typeof crystalData === 'object' &&
          Object.keys(crystalData).length > 0,
      );
      setUnitCellAvailable(hasUnitCell);
      setUnitCellVisible(hasUnitCell ? unitCellPreferenceRef.current : false);

      const labels = currentFrame
        .split('\n')
        .slice(2)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(/\s+/)[0] ?? 'Atom');
      setAtomLabels(labels);
      setSelectedSerials([]);

      if (!zoomedRef.current) {
        viewer.zoomTo();
        zoomedRef.current = true;
      }

      model.setClickable({}, true, (atom: ThreeDmolAtom, _viewer: unknown, event?: MouseEvent) => {
        const serial = atom.serial ?? atom.index;
        if (serial === undefined) {
          return;
        }

        setSelectedSerials((previous) => {
          const isMulti = Boolean(event?.shiftKey || event?.metaKey || event?.ctrlKey);
          if (!isMulti) {
            return previous.length === 1 && previous[0] === serial ? [] : [serial];
          }
          return previous.includes(serial)
            ? previous.filter((entry) => entry !== serial)
            : [...previous, serial];
        });
      });

      model.setHoverable(
        {},
        true,
        (atom: ThreeDmolAtom, _viewer: unknown, event?: MouseEvent) => {
          if (!event) {
            return;
          }

          setHoveredAtom({
            x: event.clientX,
            y: event.clientY,
            label: `${atom.atom || atom.elem || 'Atom'} (${atom.serial ?? atom.index ?? '?'})`,
            coords: {
              x: atom.x.toFixed(2),
              y: atom.y.toFixed(2),
              z: atom.z.toFixed(2),
            },
          });
        },
        () => setHoveredAtom(null),
      );

      viewer.render();
    } catch (error) {
      console.error('Failed to render molecule:', error);
      setViewerInitError('Unable to render this molecular structure.');
    }
  }, [currentFrame, viewerData.format]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const model = modelRef.current;
    if (!viewer || !model) {
      return;
    }

    try {
      viewer.removeUnitCell(model);
    } catch {
      // Some 3Dmol formats do not support unit cell removal before one exists.
    }

    if (unitCellVisible && unitCellAvailable) {
      try {
        viewer.addUnitCell(model, {
          box: {
            color: 'black',
            opacity: 1,
            linewidth: 5,
          },
          astyle: { radius: 0.12, mid: 0.85, color: 'red', opacity: 0.6 },
          bstyle: { radius: 0.12, mid: 0.85, color: 'green', opacity: 0.6 },
          cstyle: { radius: 0.12, mid: 0.85, color: 'blue', opacity: 0.6 },
          alabel: 'a',
          blabel: 'b',
          clabel: 'c',
        });
      } catch {
        setUnitCellAvailable(false);
        setUnitCellVisible(false);
      }
    }

    viewer.render();
  }, [unitCellAvailable, unitCellVisible, currentFrame]);

  useEffect(() => {
    const viewer = viewerRef.current;
    const model = modelRef.current;
    if (!viewer || !model || !currentFrame) {
      return;
    }

    model.setStyle({}, { stick: { radius: 0.2 }, sphere: { scale: 0.3 } });

    if (selectedSerials.length > 0) {
      model.setStyle(
        { serial: selectedSerials as unknown as number },
        {
          stick: { radius: 0.3, color: 'yellow' },
          sphere: { scale: 0.4, color: 'yellow' },
        },
      );
    }

    viewer.render();
    onSelectionChange?.({ moleculeId, atoms: selectedSerials });
  }, [currentFrame, moleculeId, onSelectionChange, selectedSerials]);

  useEffect(() => {
    if (!currentFrame) {
      return;
    }

    let animationFrame = 0;
    const tick = () => {
      const view = viewerRef.current?.getView?.();
      if (Array.isArray(view) && view.length >= 8) {
        const [x, y, z, zoom, qx, qy, qz, qw] = view;
        if (
          typeof x === 'number' &&
          typeof y === 'number' &&
          typeof z === 'number' &&
          typeof zoom === 'number' &&
          typeof qx === 'number' &&
          typeof qy === 'number' &&
          typeof qz === 'number' &&
          typeof qw === 'number'
        ) {
          setCameraInfo({ x, y, z, zoom, qx, qy, qz, qw });
        }
      }
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [currentFrame]);

  const copyCurrentFrame = useCallback(async () => {
    if (!currentFrame) {
      return;
    }
    await navigator.clipboard.writeText(currentFrame);
  }, [currentFrame]);

  const captureScreenshot = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer?.pngURI) {
      return;
    }

    viewer.render();
    const image = viewer.pngURI();
    if (!image) {
      return;
    }

    try {
      const response = await fetch(image);
      const blob = await response.blob();
      const clipboardItemInput: Record<string, Blob> = {
        [blob.type || 'image/png']: blob,
      };
      const clipboardItem = new ClipboardItem(clipboardItemInput);
      await navigator.clipboard.write([clipboardItem]);
    } catch {
      // Clipboard image writes are not supported in every browser.
    }

    onScreenshot?.({ moleculeId, image });
  }, [moleculeId, onScreenshot]);

  const resetCamera = useCallback(() => {
    const viewer = viewerRef.current;
    if (!viewer) {
      return;
    }

    viewer.zoomTo();
    viewer.setCameraParameters({});
    viewer.render();
  }, []);

  return (
    <div className={`xyz-viewer-plugin ${className}`}>
      <header className="xyz-viewer-plugin__header">
        <div>
          <h2>{title}</h2>
          <p>{viewerData.format.toUpperCase()} structure preview</p>
        </div>
        <span>{frames.length > 1 ? `${frames.length} frames` : 'single frame'}</span>
      </header>

      <div className="xyz-viewer-plugin__toolbar" aria-label="Molecule controls">
        <button type="button" onClick={copyCurrentFrame} disabled={!currentFrame} title="Copy current frame">
          <Copy aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() =>
            downloadTextFile(
              currentFrame,
              `${currentSlug}_frame_${currentFrameIndex + 1}.${viewerData.format}`,
            )
          }
          disabled={!currentFrame}
          title="Download current frame"
        >
          <Download aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() =>
            downloadTextFile(
              viewerData.exportContent,
              `${currentSlug}_trajectory.${viewerData.format}`,
            )
          }
          disabled={!viewerData.exportContent}
          title="Download all frames"
        >
          <Box aria-hidden="true" />
        </button>
        <button type="button" onClick={captureScreenshot} disabled={!currentFrame} title="Capture screenshot">
          <Camera aria-hidden="true" />
        </button>
        <span className="xyz-viewer-plugin__toolbar-divider" aria-hidden="true" />
        <button type="button" onClick={() => viewerRef.current?.zoom(1.2)} disabled={!currentFrame} title="Zoom in">
          <ZoomIn aria-hidden="true" />
        </button>
        <button type="button" onClick={() => viewerRef.current?.zoom(0.8)} disabled={!currentFrame} title="Zoom out">
          <ZoomOut aria-hidden="true" />
        </button>
        <button type="button" onClick={resetCamera} disabled={!currentFrame} title="Reset camera">
          <RotateCcw aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() =>
            setUnitCellVisible((previous) => {
              const next = !previous;
              unitCellPreferenceRef.current = next;
              return next;
            })
          }
          disabled={!unitCellAvailable}
          title={unitCellVisible ? 'Hide unit cell' : 'Show unit cell'}
        >
          <Boxes aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => setSelectedSerials([])}
          disabled={selectedSerials.length === 0}
          title="Clear selection"
        >
          <Trash2 aria-hidden="true" />
        </button>
      </div>

      <div className="xyz-viewer-plugin__stage">
        <div ref={viewerHostRef} className="xyz-viewer-plugin__canvas" />
        {viewerInitError && (
          <div className="xyz-viewer-plugin__error">{viewerInitError}</div>
        )}
        {!viewerInitError && !currentFrame && (
          <div className="xyz-viewer-plugin__empty">No molecule data available.</div>
        )}
        {hoveredAtom && (
          <div
            className="xyz-viewer-plugin__tooltip"
            style={{
              left: hoveredAtom.x - 20,
              top: hoveredAtom.y - 50,
            }}
          >
            <strong>{hoveredAtom.label}</strong>
            <span>
              x: {hoveredAtom.coords.x} y: {hoveredAtom.coords.y} z:{' '}
              {hoveredAtom.coords.z}
            </span>
          </div>
        )}
      </div>

      {frames.length > 1 && (
        <div className="xyz-viewer-plugin__timeline">
          <button
            type="button"
            onClick={() => {
              setIsPlaying((previous) => {
                const next = !previous;
                if (next && currentFrameIndex === frames.length - 1) {
                  setCurrentFrameIndex(0);
                }
                return next;
              });
            }}
            title={isPlaying ? 'Pause trajectory' : 'Play trajectory'}
          >
            {isPlaying && currentFrameIndex !== frames.length - 1 ? (
              <Pause aria-hidden="true" />
            ) : (
              <Play aria-hidden="true" />
            )}
          </button>
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            step={1}
            value={currentFrameIndex}
            onChange={(event) => setCurrentFrameIndex(Number(event.currentTarget.value))}
            aria-label="Trajectory frame"
          />
          <button
            type="button"
            className={isLive ? 'is-live' : ''}
            onClick={() => setCurrentFrameIndex(frames.length - 1)}
          >
            Live
          </button>
          <span>
            {currentFrameIndex + 1} / {frames.length}
          </span>
        </div>
      )}

      <footer className="xyz-viewer-plugin__status">
        <span>
          Selected atoms:{' '}
          {selectedSerials.length > 0
            ? selectedSerials
                .map((serial) => `${atomLabels[serial] ?? 'Atom'}(${serial})`)
                .join(', ')
            : 'None'}
        </span>
        {cameraInfo && (
          <span>
            Camera x={cameraInfo.x.toFixed(1)} y={cameraInfo.y.toFixed(1)} z=
            {cameraInfo.z.toFixed(1)}
          </span>
        )}
      </footer>
    </div>
  );
}
