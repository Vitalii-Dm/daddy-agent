export function syncTelemetryFlag(_enabled: boolean): void {}
export function addMainBreadcrumb(..._args: unknown[]): void {}
export function startMainSpan<T>(...args: unknown[]): T {
  const callback = args[args.length - 1] as () => T;
  return callback();
}
