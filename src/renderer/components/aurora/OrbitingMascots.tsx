import React from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { Mascot, type MascotRole } from './Mascot';

// Orbit definition — each satellite traces an ellipse around the hero
// robot. Ellipse instead of circle (squish < 1) sells the 3D depth;
// scale + opacity follow the angle so satellites visibly pass behind
// (smaller, faded) and in front (larger, opaque) of the robot.
interface Orbit {
  role: MascotRole;
  radius: number;
  duration: number;
  phase: number;
  squish: number;
  size: 24 | 32 | 48;
}

const ORBITS: Orbit[] = [
  { role: 'reviewer', radius: 200, duration: 28, phase: 0.0, squish: 0.55, size: 32 },
  { role: 'coder', radius: 240, duration: 36, phase: 0.33, squish: 0.4, size: 32 },
  { role: 'researcher', radius: 180, duration: 24, phase: 0.66, squish: 0.65, size: 32 },
  { role: 'designer', radius: 260, duration: 42, phase: 0.5, squish: 0.45, size: 24 },
];

const STEPS = [0, 0.25, 0.5, 0.75, 1] as const;

interface OrbitingMascotsProps {
  centerX: number;
  centerY: number;
}

export const OrbitingMascots = ({ centerX, centerY }: OrbitingMascotsProps): React.JSX.Element => {
  const reduceMotion = useReducedMotion();

  // Static orbits would just be visual noise, so reduced-motion users
  // get nothing. The Spline mascot is enough on its own.
  if (reduceMotion) return <></>;

  return (
    <div
      className="pointer-events-none absolute inset-0"
      aria-hidden
      style={{ perspective: '1200px' }}
    >
      {ORBITS.map((orbit) => {
        const xs = STEPS.map((s) => orbit.radius * Math.cos((orbit.phase + s) * 2 * Math.PI));
        const ys = STEPS.map(
          (s) => orbit.radius * orbit.squish * Math.sin((orbit.phase + s) * 2 * Math.PI)
        );
        return (
          <motion.div
            key={orbit.role}
            className="absolute"
            style={{
              left: centerX,
              top: centerY,
              width: 0,
              height: 0,
            }}
          >
            <motion.div
              style={{ position: 'absolute', transform: 'translate(-50%, -50%)' }}
              animate={{
                x: xs,
                y: ys,
                // Larger + opaque when the satellite is at the bottom of
                // the ellipse (in front of the robot), smaller + faded
                // at the top (behind). That's what sells the 3D feel.
                scale: [0.7, 1.0, 1.1, 1.0, 0.7],
                opacity: [0.45, 0.85, 1.0, 0.85, 0.45],
              }}
              transition={{
                duration: orbit.duration,
                ease: 'linear',
                repeat: Infinity,
                repeatType: 'loop',
              }}
            >
              <div
                style={{
                  filter: 'drop-shadow(0 8px 16px rgba(124, 92, 255, 0.18))',
                }}
              >
                <Mascot role={orbit.role} seed={`orbit-${orbit.role}`} size={orbit.size} />
              </div>
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
};
