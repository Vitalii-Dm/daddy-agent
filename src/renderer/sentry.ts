export function initSentryRenderer(): void {}
export function syncRendererTelemetry(_enabled: boolean): void {}
export function addNavigationBreadcrumb(_from: string, _to: string): void {}
export function captureRendererException(_error: unknown, ..._extra: unknown[]): void {}
export function isSentryRendererActive(): boolean {
  return false;
}
