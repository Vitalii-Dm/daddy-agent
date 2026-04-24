import React, { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { cn } from '@renderer/lib/utils';

export type MascotRole = 'lead' | 'coder' | 'reviewer' | 'researcher' | 'designer' | 'ops';
export type MascotStatus = 'idle' | 'thinking' | 'coding' | 'blocked' | 'done' | 'waiting';

interface RolePalette {
  body: [string, string];
  accent: string;
  glyph: 'baton' | 'glasses' | 'monocle' | 'beret' | 'bristles' | 'wrench';
  hue: number;
}

const ROLE_PALETTES: Record<MascotRole, RolePalette> = {
  lead: { body: ['#A48BFF', '#7C5CFF'], accent: '#FFD9F2', glyph: 'baton', hue: 260 },
  coder: { body: ['#7BD8FF', '#3DC6FF'], accent: '#E2F4FF', glyph: 'glasses', hue: 198 },
  reviewer: { body: ['#FFB99B', '#FF9C7A'], accent: '#FFEFE5', glyph: 'monocle', hue: 18 },
  researcher: { body: ['#D6F8A8', '#B8F27B'], accent: '#F4FFE2', glyph: 'beret', hue: 82 },
  designer: { body: ['#C7B8FF', '#9F8AFF'], accent: '#FFF1FB', glyph: 'bristles', hue: 280 },
  ops: { body: ['#C9CDD4', '#9CA3AF'], accent: '#F1F2F4', glyph: 'wrench', hue: 220 },
};

const STATUS_COLOR: Record<MascotStatus, string> = {
  idle: 'var(--ink-4)',
  thinking: 'var(--info)',
  coding: 'var(--ok)',
  blocked: 'var(--err)',
  done: 'var(--ok)',
  waiting: 'var(--warn)',
};

interface MascotProps {
  role: MascotRole;
  size?: 24 | 32 | 48 | 64 | 96 | 128;
  seed?: string;
  status?: MascotStatus;
  halo?: boolean;
  className?: string;
  ariaLabel?: string;
}

// Sticker-style procedural mascot. The body is a per-seed wobbled blob so
// each agent gets a slightly different head shape, but the role palette and
// glyph keep the family coherent. This is the "Pipeline C" variant from the
// design brief — refined enough to ship as the production avatar without
// waiting on Gemini-generated PNGs.
export const Mascot = ({
  role,
  size = 48,
  seed = role,
  status,
  halo = false,
  className,
  ariaLabel,
}: MascotProps): React.JSX.Element => {
  const palette = ROLE_PALETTES[role];
  const reduceMotion = useReducedMotion();
  const id = useMemo(() => `mascot-${seed}-${Math.random().toString(36).slice(2, 8)}`, [seed]);
  const path = useMemo(() => buildBlobPath(seed), [seed]);
  const eyeOffset = useMemo(() => seedRand(seed, 9) * 1.4 - 0.7, [seed]);
  const breath = !reduceMotion && (status === 'thinking' || status === 'coding');

  return (
    <motion.div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      animate={breath ? { scale: [1, 1.04, 1] } : undefined}
      transition={breath ? { duration: 1.6, ease: 'easeInOut', repeat: Infinity } : undefined}
      role="img"
      aria-label={ariaLabel ?? `${role} agent mascot`}
    >
      {halo && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-[-22%] rounded-full blur-[18px]"
          style={{
            background: `radial-gradient(circle at center, ${palette.body[0]}55, transparent 70%)`,
          }}
        />
      )}
      {pngUrlFor(role) !== null ? (
        <img
          src={pngUrlFor(role) ?? undefined}
          alt=""
          width={size}
          height={size}
          className="block"
          draggable={false}
        />
      ) : (
        <svg viewBox="0 0 100 100" width={size} height={size} aria-hidden="true">
        <defs>
          <radialGradient id={`${id}-body`} cx="42%" cy="36%" r="72%">
            <stop offset="0%" stopColor={palette.body[0]} />
            <stop offset="62%" stopColor={palette.body[1]} />
            <stop offset="100%" stopColor={shade(palette.body[1], -16)} />
          </radialGradient>
          <radialGradient id={`${id}-spec`} cx="38%" cy="28%" r="34%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id={`${id}-shadow`} cx="50%" cy="92%" r="40%">
            <stop offset="0%" stopColor="rgba(20,19,26,0.32)" />
            <stop offset="100%" stopColor="rgba(20,19,26,0)" />
          </radialGradient>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(255,255,255,0.65)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </linearGradient>
        </defs>

        {/* Soft contact shadow */}
        <ellipse cx="50" cy="93" rx="28" ry="4" fill={`url(#${id}-shadow)`} />

        {/* Body blob */}
        <path d={path} fill={`url(#${id}-body)`} />
        <path d={path} fill={`url(#${id}-spec)`} opacity="0.85" />
        <path d={path} fill="none" stroke={`url(#${id}-rim)`} strokeWidth="0.8" />

        {/* Role-specific accessory — the family glyph */}
        <RoleGlyph glyph={palette.glyph} accent={palette.accent} body={palette.body[1]} />

        {/* Eyes — slightly seed-jittered for personality */}
        <g>
          <ellipse cx={38 + eyeOffset} cy={56} rx="3.4" ry="4.6" fill="#14131A" />
          <ellipse cx={62 + eyeOffset} cy={56} rx="3.4" ry="4.6" fill="#14131A" />
          <circle cx={37 + eyeOffset} cy={54} r="1.1" fill="white" />
          <circle cx={61 + eyeOffset} cy={54} r="1.1" fill="white" />
        </g>

        {/* Subtle smile */}
        <path
          d="M44 70 Q50 74 56 70"
          stroke="#14131A"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      )}

      {status && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 right-0 inline-flex h-[28%] w-[28%] items-center justify-center rounded-full"
          style={{
            background: STATUS_COLOR[status],
            boxShadow: '0 0 0 2px var(--bg-base), 0 2px 6px -2px rgba(20,19,26,0.35)',
          }}
        >
          {status === 'thinking' && !reduceMotion && (
            <motion.span
              className="absolute inset-0 rounded-full"
              style={{ background: STATUS_COLOR.thinking, opacity: 0.6 }}
              animate={{ scale: [1, 1.6], opacity: [0.6, 0] }}
              transition={{ duration: 1.4, ease: 'easeOut', repeat: Infinity }}
            />
          )}
        </span>
      )}
    </motion.div>
  );
};

interface RoleGlyphProps {
  glyph: RolePalette['glyph'];
  accent: string;
  body: string;
}

const RoleGlyph = ({ glyph, accent, body }: RoleGlyphProps): React.JSX.Element | null => {
  switch (glyph) {
    case 'baton':
      // tiny conductor's pen poking down behind the head
      return (
        <g>
          <rect
            x="69"
            y="20"
            width="3"
            height="22"
            rx="1.5"
            transform="rotate(28 70 31)"
            fill={accent}
          />
          <circle
            cx="73"
            cy="20"
            r="2.6"
            fill={accent}
            stroke={shade(body, -20)}
            strokeWidth="0.6"
          />
        </g>
      );
    case 'glasses':
      return (
        <g>
          <circle cx="38" cy="56" r="7.2" fill="none" stroke={accent} strokeWidth="1.4" />
          <circle cx="62" cy="56" r="7.2" fill="none" stroke={accent} strokeWidth="1.4" />
          <line x1="45.2" y1="56" x2="54.8" y2="56" stroke={accent} strokeWidth="1.4" />
        </g>
      );
    case 'monocle':
      return (
        <g>
          <circle cx="62" cy="56" r="9" fill="none" stroke={accent} strokeWidth="1.6" />
          <line x1="62" y1="65" x2="60" y2="74" stroke={accent} strokeWidth="1.2" />
        </g>
      );
    case 'beret':
      return (
        <g>
          <ellipse
            cx="50"
            cy="22"
            rx="22"
            ry="9"
            fill={accent}
            stroke={shade(body, -20)}
            strokeWidth="0.6"
          />
          <circle cx="68" cy="18" r="2.2" fill={accent} />
        </g>
      );
    case 'bristles':
      return (
        <g>
          <rect
            x="44"
            y="14"
            width="12"
            height="8"
            rx="2"
            fill={accent}
            stroke={shade(body, -20)}
            strokeWidth="0.6"
          />
          <line x1="46" y1="14" x2="46" y2="9" stroke={shade(body, -10)} strokeWidth="1.2" />
          <line x1="50" y1="14" x2="50" y2="7" stroke={shade(body, -10)} strokeWidth="1.2" />
          <line x1="54" y1="14" x2="54" y2="9" stroke={shade(body, -10)} strokeWidth="1.2" />
        </g>
      );
    case 'wrench':
      return (
        <g>
          <circle
            cx="78"
            cy="58"
            r="3.2"
            fill={accent}
            stroke={shade(body, -20)}
            strokeWidth="0.6"
          />
          <line x1="78" y1="61" x2="78" y2="68" stroke={accent} strokeWidth="1.6" />
        </g>
      );
    default:
      return null;
  }
};

// Hash a string into a stable [0,1) sample
function seedRand(seed: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

// Deterministic 8-control-point blob, slightly wobbled by seed so every agent
// gets a unique head shape.
function buildBlobPath(seed: string): string {
  const cx = 50;
  const cy = 52;
  const baseR = 36;
  const points = 8;
  const coords: Array<[number, number]> = [];
  for (let i = 0; i < points; i += 1) {
    const angle = (Math.PI * 2 * i) / points - Math.PI / 2;
    const wobble = (seedRand(seed, i + 1) - 0.5) * 5;
    const r = baseR + wobble;
    coords.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]);
  }
  // Catmull-Rom-ish smoothing into cubic bezier segments
  const path: string[] = [];
  for (let i = 0; i < points; i += 1) {
    const p0 = coords[(i - 1 + points) % points];
    const p1 = coords[i];
    const p2 = coords[(i + 1) % points];
    const p3 = coords[(i + 2) % points];
    if (i === 0) path.push(`M ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}`);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    path.push(
      `C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`
    );
  }
  path.push('Z');
  return path.join(' ');
}

// Hex shade by ±n percentage points of luminance (rough)
function shade(hex: string, percent: number): string {
  const cleaned = hex.replace('#', '');
  const num = parseInt(cleaned, 16);
  let r = (num >> 16) + Math.round((percent / 100) * 255);
  let g = ((num >> 8) & 0xff) + Math.round((percent / 100) * 255);
  let b = (num & 0xff) + Math.round((percent / 100) * 255);
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// Helper: pick a role from a free-form member.role / agentType string.
const ROLE_KEYWORDS: Array<[RegExp, MascotRole]> = [
  [/lead|orchestrator|conductor|cto|owner/i, 'lead'],
  [/review|qa|critic|audit/i, 'reviewer'],
  [/research|explore|discover|analyst/i, 'researcher'],
  [/design|ux|ui|brand/i, 'designer'],
  [/ops|infra|sre|devops|deploy/i, 'ops'],
  [/code|engineer|builder|dev|implement/i, 'coder'],
];

export function inferMascotRole(input?: string | null): MascotRole {
  if (!input) return 'coder';
  for (const [re, role] of ROLE_KEYWORDS) {
    if (re.test(input)) return role;
  }
  return 'coder';
}

// Map a member.status string from the team data into a mascot status. Anything
// unrecognised falls back to "idle" so the dot is rendered but neutral.
const STATUS_MAP: Record<string, MascotStatus> = {
  idle: 'idle',
  ready: 'idle',
  thinking: 'thinking',
  busy: 'thinking',
  running: 'coding',
  active: 'coding',
  coding: 'coding',
  blocked: 'blocked',
  failed: 'blocked',
  error: 'blocked',
  waiting: 'waiting',
  pending: 'waiting',
  done: 'done',
  completed: 'done',
};

export function inferMascotStatus(input?: string | null): MascotStatus | undefined {
  if (!input) return undefined;
  const key = input.toLowerCase();
  return STATUS_MAP[key];
}

// PNG art for each role lives at src/renderer/assets/mascots/<role>.png. When
// a file is dropped in, Vite resolves it eagerly here as a static URL and the
// component renders an <img>; otherwise it falls back to the procedural SVG.
// See src/renderer/assets/mascots/README.md for the swap path.
const PNG_BY_ROLE: Record<string, string> = import.meta.glob(
  '../../assets/mascots/*.png',
  { eager: true, query: '?url', import: 'default' }
);

function pngUrlFor(role: MascotRole): string | null {
  const key = Object.keys(PNG_BY_ROLE).find((k) => k.endsWith('/' + role + '.png'));
  return key ? PNG_BY_ROLE[key] : null;
}
