export interface NativeAppBridge {
  platform: 'ios' | 'android';
  changeRelay(): void;
  notificationSettings(): void;
}
export function nativeAppBridge(): NativeAppBridge | undefined {
  return (window as Window & { remoteCodexNative?: NativeAppBridge }).remoteCodexNative;
}
