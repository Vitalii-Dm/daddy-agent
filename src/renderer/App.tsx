import React, { useEffect } from 'react';

import { TooltipProvider } from '@renderer/components/ui/tooltip';

import { AuroraShell } from './components/aurora/AuroraShell';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { TabbedLayout } from './components/layout/TabbedLayout';
import { useTheme } from './hooks/useTheme';

// VITE_SHELL controls the renderer surface: 'aurora' (default — Liquid Glass
// shell) or 'classic' (the original TabbedLayout, kept for A/B during the
// hackathon and as a safety net while the redesign stabilises).
const SHELL_MODE = (import.meta.env.VITE_SHELL ?? 'aurora') as 'aurora' | 'classic';

export const App = (): React.JSX.Element => {
  useTheme();

  useEffect(() => {
    const splash = document.getElementById('splash');
    if (splash) {
      splash.style.opacity = '0';
      setTimeout(() => splash.remove(), 300);
    }
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider delayDuration={150} skipDelayDuration={1500}>
        {SHELL_MODE === 'classic' ? <TabbedLayout /> : <AuroraShell />}
      </TooltipProvider>
    </ErrorBoundary>
  );
};
