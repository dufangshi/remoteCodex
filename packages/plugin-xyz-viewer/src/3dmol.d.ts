declare module '3dmol' {
  export interface AtomSpec {
    atom?: string;
    elem?: string;
    index?: number;
    serial?: number;
    x: number;
    y: number;
    z: number;
  }

  export interface GLModel {
    getCrystData(): Record<string, unknown> | null | undefined;
    setClickable(
      selection: Record<string, unknown>,
      clickable: boolean,
      callback: (atom: AtomSpec, viewer: GLViewer, event?: MouseEvent) => void,
    ): void;
    setHoverable(
      selection: Record<string, unknown>,
      hoverable: boolean,
      hoverCallback: (atom: AtomSpec, viewer: GLViewer, event?: MouseEvent) => void,
      unhoverCallback: (atom: AtomSpec, viewer: GLViewer, event?: MouseEvent) => void,
    ): void;
    setStyle(
      selection: Record<string, unknown>,
      style: Record<string, unknown>,
    ): void;
  }

  export interface GLViewer {
    addModel(content: string, format: string): GLModel;
    addUnitCell(model: GLModel, options?: Record<string, unknown>): void;
    getView?(): unknown[];
    pngURI?(): string;
    removeAllLabels(): void;
    removeAllModels(): void;
    removeAllShapes(): void;
    removeUnitCell(model: GLModel): void;
    render(): void;
    resize(): void;
    setBackgroundColor(color: string, opacity?: number): void;
    setCameraParameters(parameters: Record<string, unknown>): void;
    zoom(factor: number): void;
    zoomTo(): void;
  }

  export function createViewer(
    element: HTMLElement,
    options?: Record<string, unknown>,
  ): GLViewer;
}
