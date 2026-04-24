import React, { useEffect } from 'react';

import { destroyLenis, initLenis } from '@renderer/lib/lenis';

import { CommandBar } from './CommandBar';
import { GlobalBackground } from './GlobalBackground';
import { RefractFilter } from './RefractFilter';
import { TopRail } from './TopRail';
import { DashboardSection } from './sections/DashboardSection';
import { GraphSectionPlaceholder } from './sections/GraphSectionPlaceholder';
import { HeroSection } from './sections/HeroSection';

// Top-level Liquid Glass shell. Owns the aurora theme attribute, the SVG
// refraction filter, the global background, the floating top rail, the
// Lenis smooth-scroll instance, and the vertical document of sections.
export const AuroraShell = (): React.JSX.Element => {
  useEffect(() => {
    const previous = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = 'aurora';
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduceMotion) {
      initLenis();
    }
    return () => {
      destroyLenis();
      if (previous) {
        document.documentElement.dataset.theme = previous;
      } else {
        delete document.documentElement.dataset.theme;
      }
    };
  }, []);

  return (
    <div
      className="relative min-h-screen w-full overflow-x-hidden text-[color:var(--ink-1)]"
      style={{ fontFamily: 'var(--font-sans)' }}
    >
      <RefractFilter />
      <GlobalBackground />
      <TopRail />
      <main className="relative z-0">
        <HeroSection />
        <DashboardSection />
        <GraphSectionPlaceholder />
      </main>
      <CommandBar />
    </div>
  );
};
