import React, { lazy, Suspense, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';

// Lazy-load Spline so the WebGL bundle (~600KB) only loads when the
// hero is visible. The runtime streams from prod.spline.design — we
// keep a static glass-blob poster behind it so the hero never looks
// blank during the 1–3s scene fetch.
const Spline = lazy(() => import('@splinetool/react-spline'));

const SCENE_URL = 'https://prod.spline.design/KgOazk3o0qW51UIF/scene.splinecode';

// Vite-eager glob for the optional poster PNG. If a designer drops
// daddy-wave-1.png into src/renderer/assets/mascots/, it shows during
// the load and as the reduced-motion fallback. Otherwise we render a
// soft glass blob — same visual idiom as HeroMascot.
const POSTER_PNGS: Record<string, string> = import.meta.glob(
  '../../assets/mascots/daddy-wave-*.png',
  { eager: true, query: '?url', import: 'default' }
);
const POSTER_URL: string | null = (() => {
  const key = Object.keys(POSTER_PNGS).find((k) => /\/daddy-wave-1\.png$/.test(k));
  return key ? POSTER_PNGS[key] : null;
})();

const PosterFallback = ({ size }: { size: number }): React.JSX.Element => {
  if (POSTER_URL) {
    return (
      <img
        src={POSTER_URL}
        alt=""
        aria-hidden
        width={size}
        height={size}
        style={{ width: size, height: 'auto', display: 'block' }}
        draggable={false}
      />
    );
  }
  // Soft violet/cyan glass blob — matches the v6 HeroMascot placeholder
  // so the hero looks the same before and after the Spline scene loads.
  const w = size * 0.78;
  return (
    <div
      aria-hidden
      style={{
        width: w,
        height: w,
        borderRadius: '50%',
        background:
          'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.7), rgba(124,92,255,0.45) 45%, rgba(61,198,255,0.35) 80%)',
        filter: 'blur(0.4px) drop-shadow(0 24px 48px rgba(124, 92, 255, 0.25))',
      }}
    />
  );
};

interface SplineMascotProps {
  className?: string;
  size?: number;
}

export const SplineMascot = ({ className, size = 520 }: SplineMascotProps): React.JSX.Element => {
  const [loaded, setLoaded] = useState(false);
  const reduceMotion = useReducedMotion();

  // Reduced-motion users get the static poster (or blob) forever — no
  // WebGL, no autoplay, no surprise CPU spend.
  if (reduceMotion) {
    return (
      <div
        className={className}
        style={{ width: size, height: size, display: 'grid', placeItems: 'center' }}
        aria-hidden
      >
        <PosterFallback size={size} />
      </div>
    );
  }

  return (
    <div
      className={className}
      style={{ width: size, height: size, position: 'relative' }}
      aria-hidden
    >
      {/* Poster fades out once Spline reports onLoad. */}
      <AnimatePresence>
        {!loaded && (
          <motion.div
            key="poster"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
            style={{
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              pointerEvents: 'none',
            }}
          >
            <PosterFallback size={size} />
          </motion.div>
        )}
      </AnimatePresence>

      <Suspense fallback={null}>
        <Spline
          scene={SCENE_URL}
          onLoad={() => setLoaded(true)}
          style={{
            width: '100%',
            height: '100%',
            // Mask the rectangular WebGL canvas so its edges fade into
            // the hero background — same trick used elsewhere for video
            // integrations.
            maskImage: 'radial-gradient(circle at center, black 55%, transparent 90%)',
            WebkitMaskImage: 'radial-gradient(circle at center, black 55%, transparent 90%)',
          }}
        />
      </Suspense>
      {/* Overlay covering Spline's "Built with Spline" watermark.
          A single large radial gradient that's solid paper at the
          badge centre and feathers all the way out to fully
          transparent. No hard rectangle, no backdrop blur (which
          pulled darkness in), no second layer. The radial extends
          well past the badge so the fade has room to disappear into
          the surrounding hero gradient. */}
      <div
        aria-hidden
        className="pointer-events-none absolute"
        style={{
          right: -24,
          bottom: -24,
          width: 320,
          height: 140,
          background:
            'radial-gradient(ellipse 50% 35% at 60% 60%, var(--bg-base) 0%, var(--bg-base) 28%, rgba(246, 243, 238, 0.85) 50%, rgba(246, 243, 238, 0.4) 70%, transparent 100%)',
        }}
      />
    </div>
  );
};
