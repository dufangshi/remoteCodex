import type { GLModel, GLViewer } from '3dmol';

export type ThreeDmolApi = {
  createViewer(element: HTMLElement, options?: Record<string, unknown>): GLViewer;
};

declare global {
  interface Window {
    '3Dmol'?: ThreeDmolApi;
  }
}

let threeDmolPromise: Promise<ThreeDmolApi> | null = null;

export async function load3Dmol(): Promise<ThreeDmolApi> {
  if (typeof window === 'undefined') {
    throw new Error('3Dmol is only available in a browser environment.');
  }

  if (window['3Dmol']) {
    return window['3Dmol'];
  }

  if (!threeDmolPromise) {
    threeDmolPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>(
        'script[data-remote-codex-3dmol="true"]',
      );

      const handleLoad = () => {
        if (window['3Dmol']) {
          resolve(window['3Dmol']);
          return;
        }
        reject(new Error('3Dmol loaded without exposing the expected global.'));
      };

      if (existingScript) {
        existingScript.addEventListener('load', handleLoad, { once: true });
        existingScript.addEventListener(
          'error',
          () => reject(new Error('Unable to load 3Dmol viewer runtime.')),
          { once: true },
        );
        return;
      }

      const script = document.createElement('script');
      script.src = '/vendor/3Dmol-min.js';
      script.async = true;
      script.dataset.remoteCodex3dmol = 'true';
      script.addEventListener('load', handleLoad, { once: true });
      script.addEventListener(
        'error',
        () => reject(new Error('Unable to load 3Dmol viewer runtime.')),
        { once: true },
      );
      document.head.appendChild(script);
    });
  }

  return threeDmolPromise;
}

export type { GLModel, GLViewer };
