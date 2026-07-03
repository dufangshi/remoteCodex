export interface NativeHttpRequestInput {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
  bodyBase64?: string | null;
}

interface NativeHttpResponseEnvelope {
  requestId: string;
  ok: boolean;
  statusCode: number;
  headers?: Record<string, string>;
  body?: string | null;
  bodyBase64?: string | null;
  error?: string | null;
}

export type NativeFilePickResult = {
  requestId: string;
  cancelled?: boolean;
  error?: string | null;
  file?: {
    filename: string;
    contentType?: string | null;
    base64: string;
  } | null;
};

type NativeHttpResolver = {
  resolve(value: NativeHttpResponseEnvelope): void;
  reject(error: Error): void;
};

type NativeFilePickResolver = {
  resolve(value: NativeFilePickResult): void;
  reject(error: Error): void;
};

let requestCounter = 0;
const pendingRequests = new Map<string, NativeHttpResolver>();
let filePickCounter = 0;
const pendingFilePicks = new Map<string, NativeFilePickResolver>();

declare global {
  interface Window {
    remoteCodexAndroid?: {
      postMessage(message: string): void;
      requestJson?(message: string): void;
      pickFile?(message: string): void;
    };
  }
}

export function hasNativeHttpBridge() {
  return typeof window.remoteCodexAndroid?.requestJson === 'function';
}

export function installNativeHttpResponseBridge() {
  window.remoteCodexAndroidHost = {
    ...window.remoteCodexAndroidHost,
    receiveNativeHttpResponse(response: NativeHttpResponseEnvelope) {
      const pending = pendingRequests.get(response.requestId);
      if (!pending) {
        return;
      }
      pendingRequests.delete(response.requestId);
      if (response.ok) {
        pending.resolve(response);
      } else {
        pending.reject(
          new Error(
            response.error ||
              response.body ||
              `Native HTTP request failed (${response.statusCode}).`,
          ),
        );
      }
    },
    receiveNativeFilePickResult(response: NativeFilePickResult) {
      const pending = pendingFilePicks.get(response.requestId);
      if (!pending) {
        return;
      }
      pendingFilePicks.delete(response.requestId);
      if (response.error) {
        pending.reject(new Error(response.error));
        return;
      }
      pending.resolve(response);
    },
  };
}

export function hasNativeFilePickerBridge() {
  return typeof window.remoteCodexAndroid?.pickFile === 'function';
}

export function pickNativeFile(): Promise<NativeFilePickResult> {
  if (!window.remoteCodexAndroid?.pickFile) {
    throw new Error('Android native file picker bridge is unavailable.');
  }
  filePickCounter += 1;
  const requestId = `android-file-${Date.now()}-${filePickCounter}`;
  return new Promise<NativeFilePickResult>((resolve, reject) => {
    pendingFilePicks.set(requestId, { resolve, reject });
    try {
      window.remoteCodexAndroid?.pickFile?.(JSON.stringify({ requestId }));
    } catch (caught) {
      pendingFilePicks.delete(requestId);
      reject(caught instanceof Error ? caught : new Error('Native file picker failed.'));
    }
  });
}

export async function requestNativeJson<T>(
  input: NativeHttpRequestInput,
): Promise<T> {
  const response = await requestNativeHttp(input);

  if (!response.body) {
    return undefined as T;
  }
  return JSON.parse(response.body) as T;
}

export async function requestNativeDownload(
  input: NativeHttpRequestInput,
): Promise<NativeHttpResponseEnvelope> {
  return requestNativeHttp(input);
}

async function requestNativeHttp(
  input: NativeHttpRequestInput,
): Promise<NativeHttpResponseEnvelope> {
  if (!window.remoteCodexAndroid?.requestJson) {
    throw new Error('Android native HTTP bridge is unavailable.');
  }
  requestCounter += 1;
  const requestId = `android-http-${Date.now()}-${requestCounter}`;
  const envelope = {
    requestId,
    ...input,
  };

  return new Promise<NativeHttpResponseEnvelope>(
    (resolve, reject) => {
      pendingRequests.set(requestId, { resolve, reject });
      try {
        window.remoteCodexAndroid?.requestJson?.(JSON.stringify(envelope));
      } catch (caught) {
        pendingRequests.delete(requestId);
        reject(caught instanceof Error ? caught : new Error('Native HTTP failed.'));
      }
    },
  );
}
