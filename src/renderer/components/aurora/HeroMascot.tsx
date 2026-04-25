import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

// HeroMascot — the conductor on the hero. Resolution order:
//
//   1. daddy-v2.png  — the v4 Smiski-style glass mascot, generated
//      externally via the prompt in
//      .design-handoff-v3/v3/handoff/nano-banana-prompt.txt
//   2. daddy.png     — the v3 mascot, kept as a fallback so an empty
//      v2 slot still resolves to *something* during handoff
//   3. abstract glass blob — a softly pulsing 320px violet/cyan
//      radial gradient. No figural silhouette, no human-shape SVG.
//      The user has rejected the v3 silhouette as too humanoid; the
//      placeholder is intentionally abstract until the real PNG
//      lands.
const HERO_PNGS: Record<string, string> = import.meta.glob('../../assets/mascots/daddy*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const HERO_PNG_URL: string | null = (() => {
  const v2 = Object.keys(HERO_PNGS).find((k) => /\/daddy-v2\.png$/.test(k));
  if (v2) return HERO_PNGS[v2];
  const v1 = Object.keys(HERO_PNGS).find((k) => /\/daddy\.png$/.test(k));
  return v1 ? HERO_PNGS[v1] : null;
})();

interface HeroMascotProps {
  size?: number;
  className?: string;
}

export const HeroMascot = ({ size = 420, className }: HeroMascotProps): React.JSX.Element => {
  const reduceMotion = useReducedMotion();

  if (HERO_PNG_URL) {
    return (
      <motion.img
        src={HERO_PNG_URL}
        alt=""
        aria-hidden
        className={className}
        style={{
          width: size,
          height: 'auto',
          display: 'block',
          filter: 'drop-shadow(0 24px 48px rgba(124, 92, 255, 0.25))',
        }}
        draggable={false}
        initial={reduceMotion ? false : { opacity: 0, y: 24, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      />
    );
  }
  return <HeroMascotPlaceholder size={size} className={className} reduceMotion={reduceMotion} />;
};

// Abstract glass blob — no figure, no face. Soft radial gradient that
// gently breathes. Stands in until daddy-v2.png lands.
const HeroMascotPlaceholder = ({
  size,
  className,
  reduceMotion,
}: HeroMascotProps & { reduceMotion: boolean | null }): React.JSX.Element => {
  const w = (size ?? 420) * 0.76;
  return (
    <motion.div
      aria-hidden
      className={className}
      style={{
        width: w,
        height: w,
        borderRadius: '50%',
        background:
          'radial-gradient(circle at 35% 30%, rgba(255,255,255,0.7), rgba(124,92,255,0.45) 45%, rgba(61,198,255,0.35) 80%)',
        filter: 'blur(0.4px) drop-shadow(0 24px 48px rgba(124, 92, 255, 0.25))',
      }}
      animate={reduceMotion ? undefined : { scale: [1, 1.03, 1] }}
      transition={reduceMotion ? undefined : { duration: 4, ease: 'easeInOut', repeat: Infinity }}
    />
  );
};
