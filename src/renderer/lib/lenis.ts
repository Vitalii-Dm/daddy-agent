import Lenis from 'lenis';

// Singleton Lenis instance shared by the Aurora shell. AuroraShell creates it
// on mount and tears it down on unmount; section components and the scroll
// caret read it via `getLenis()` so they can call `lenis.scrollTo('#anchor')`
// without piercing React refs.
let instance: Lenis | null = null;

export function initLenis(): Lenis {
  if (instance) return instance;
  // v5: heavier, more cinematic feel — quartic ease-out decelerates
  // harder at the end so the hero handoff feels deliberate. Duration
  // is slightly longer; wheelMultiplier nudged to 1.0 so a full notch
  // covers a meaningful chunk of the hero release.
  const lenis = new Lenis({
    duration: 1.6,
    easing: (t: number) => 1 - Math.pow(1 - t, 4),
    smoothWheel: true,
    wheelMultiplier: 1.0,
    touchMultiplier: 1.4,
  });

  function raf(time: number): void {
    lenis.raf(time);
    requestAnimationFrame(raf);
  }
  requestAnimationFrame(raf);

  instance = lenis;
  return lenis;
}

export function destroyLenis(): void {
  if (!instance) return;
  instance.destroy();
  instance = null;
}

export function getLenis(): Lenis | null {
  return instance;
}

export function scrollToAnchor(anchor: string): void {
  const target = document.getElementById(anchor.replace(/^#/, ''));
  if (!target) return;
  const lenis = getLenis();
  if (lenis) {
    lenis.scrollTo(target, { offset: -88 });
  } else {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
