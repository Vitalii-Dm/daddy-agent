/**
 * CliLogsRichView - Stub component. Rich CLI logs viewer feature has been removed.
 * Renders a plain pre-formatted log output as a fallback.
 */

interface CliLogsRichViewProps {
  cliLogsTail?: string;
  order?: 'newest-first' | 'oldest-first';
  className?: string;
}

export const CliLogsRichView = ({
  cliLogsTail,
  className,
}: CliLogsRichViewProps): React.JSX.Element | null => {
  if (!cliLogsTail) return null;
  return (
    <pre
      className={`whitespace-pre-wrap break-words font-mono text-[11px] text-[var(--color-text-muted)] ${className ?? ''}`}
    >
      {cliLogsTail}
    </pre>
  );
};
