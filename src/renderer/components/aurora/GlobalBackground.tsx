import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

const ORB_DURATION = [82, 71, 96, 88] as const;
const ORB_TRANSFORMS = [
  { x: ['-6%', '14%', '-6%'], y: ['-4%', '12%', '-4%'] },
  { x: ['10%', '-12%', '10%'], y: ['-8%', '6%', '-8%'] },
  { x: ['-10%', '8%', '-10%'], y: ['12%', '-6%', '12%'] },
  { x: ['8%', '-6%', '8%'], y: ['10%', '-12%', '10%'] },
] as const;

const ORBS = [
  { left: '8%', top: '12%', size: 980, color: 'var(--a-violet)' },
  { left: '74%', top: '18%', size: 880, color: 'var(--a-cyan)' },
  { left: '14%', top: '62%', size: 920, color: 'var(--a-peach)' },
  { left: '64%', top: '78%', size: 1040, color: 'var(--a-lime)' },
] as const;

// Fixed, non-interactive layer that lives behind the entire shell.
// 4 blurred radial gradients drift on long loops to create the aurora;
// a reduced-motion preference flattens them to static positions.
export const GlobalBackground = (): React.JSX.Element => {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ background: 'var(--bg-base)' }}
    >
      {ORBS.map((orb, i) => (
        <motion.div
          key={orb.color}
          className="absolute rounded-full will-change-transform"
          style={{
            left: orb.left,
            top: orb.top,
            width: orb.size,
            height: orb.size,
            background: `radial-gradient(circle at center, ${orb.color} 0%, transparent 65%)`,
            opacity: 0.32,
            filter: 'blur(120px)',
            transform: 'translateZ(0)',
          }}
          animate={
            reduceMotion
              ? undefined
              : {
                  x: ORB_TRANSFORMS[i].x as unknown as string[],
                  y: ORB_TRANSFORMS[i].y as unknown as string[],
                }
          }
          transition={{
            duration: ORB_DURATION[i],
            ease: 'linear',
            repeat: Infinity,
            repeatType: 'mirror',
          }}
        />
      ))}

      {/* Edge grid — fades to invisible toward the center, only catches the corners */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.5) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage: 'radial-gradient(ellipse at center, transparent 35%, black 90%)',
          WebkitMaskImage: 'radial-gradient(ellipse at center, transparent 35%, black 90%)',
          opacity: 0.25,
        }}
      />

      {/* Procedural grain overlay — SVG turbulence, no raster shipped */}
      <svg
        className="absolute inset-0 h-full w-full"
        style={{ opacity: 0.06, mixBlendMode: 'multiply' }}
      >
        <filter id="aurora-grain">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.9"
            numOctaves="2"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#aurora-grain)" />
      </svg>

      {/* Top vignette — keeps the top rail readable when orbs drift up */}
      <div
        className="absolute inset-x-0 top-0 h-40"
        style={{
          background:
            'linear-gradient(to bottom, rgba(246, 243, 238, 0.6), rgba(246, 243, 238, 0))',
        }}
      />
    </div>
  );
};
