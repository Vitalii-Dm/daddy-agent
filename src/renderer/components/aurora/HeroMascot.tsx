import React from 'react';

// HeroMascot — the conductor on the hero. When a designer drops an
// externally-generated PNG into src/renderer/assets/mascots/daddy.png
// (gen prompt at .design-handoff-v3/v3/handoff/nano-banana-prompt.txt),
// Vite resolves it eagerly here and the component renders the image.
// Until then, a soft silhouette stands in at the same scale and pose so
// layout work can land without blocking on the asset.
const HERO_PNGS: Record<string, string> = import.meta.glob('../../assets/mascots/daddy*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

const HERO_PNG_URL: string | null = (() => {
  const key = Object.keys(HERO_PNGS).find((k) => /\/daddy\.png$/.test(k));
  return key ? HERO_PNGS[key] : null;
})();

interface HeroMascotProps {
  size?: number;
  className?: string;
}

export const HeroMascot = ({ size = 420, className }: HeroMascotProps): React.JSX.Element => {
  if (HERO_PNG_URL) {
    return (
      <img
        src={HERO_PNG_URL}
        alt=""
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: 'auto', display: 'block' }}
        draggable={false}
      />
    );
  }
  return <HeroMascotPlaceholder size={size} className={className} />;
};

// Lavender-clay silhouette at the correct pose, scale, halo, and the
// four orbiting mini-mascots. Mirrors the placeholder from artboard 01
// so the hero is never visually empty during the handoff window.
const HeroMascotPlaceholder = ({ size, className }: HeroMascotProps): React.JSX.Element => {
  const w = size ?? 420;
  return (
    <div
      className={className}
      style={{
        position: 'relative',
        width: w,
        height: w * 1.05,
        display: 'grid',
        placeItems: 'center',
      }}
      aria-hidden="true"
    >
      <span
        style={{
          position: 'absolute',
          inset: -40,
          borderRadius: '50%',
          background:
            'radial-gradient(closest-side, rgba(255,255,255,0.55), rgba(184,200,255,0.35) 45%, rgba(124,92,255,0.18) 70%, transparent 90%)',
          filter: 'blur(20px)',
          zIndex: 0,
        }}
      />
      <svg
        viewBox="0 0 400 420"
        width={w}
        height={w * 1.05}
        style={{ position: 'relative', zIndex: 1 }}
      >
        <defs>
          <linearGradient id="hero-clay" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#C8B8FF" />
            <stop offset="35%" stopColor="#9F88E8" />
            <stop offset="65%" stopColor="#7C5CFF" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#6048C0" />
          </linearGradient>
          <radialGradient id="hero-skin" cx="38%" cy="32%">
            <stop offset="0%" stopColor="#FFE2D2" />
            <stop offset="60%" stopColor="#F2B89A" />
            <stop offset="100%" stopColor="#C88562" />
          </radialGradient>
          <radialGradient id="hero-baton" cx="50%" cy="50%">
            <stop offset="0%" stopColor="#FFFFFF" />
            <stop offset="40%" stopColor="#B8F27B" />
            <stop offset="100%" stopColor="#3DC6FF" stopOpacity="0" />
          </radialGradient>
        </defs>

        <ellipse cx="200" cy="320" rx="120" ry="60" fill="url(#hero-clay)" opacity="0.35" />
        <path
          d="M 110 360 Q 90 250 145 215 Q 200 200 255 215 Q 310 250 290 360 Q 250 380 200 380 Q 150 380 110 360 Z"
          fill="url(#hero-clay)"
          opacity="0.92"
        />
        <ellipse cx="160" cy="365" rx="32" ry="14" fill="rgba(20,15,40,0.18)" />
        <ellipse cx="240" cy="365" rx="32" ry="14" fill="rgba(20,15,40,0.18)" />

        <ellipse
          cx="135"
          cy="260"
          rx="22"
          ry="14"
          fill="url(#hero-skin)"
          transform="rotate(-15 135 260)"
        />

        <g transform="translate(105 200)">
          <circle r="38" fill="url(#hero-baton)" opacity="0.55" />
          <circle r="22" fill="url(#hero-baton)" opacity="0.85" />
          <line
            x1="-14"
            y1="14"
            x2="14"
            y2="-14"
            stroke="#2a2230"
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx="14" cy="-14" r="4.5" fill="#FFFFFF" />
        </g>

        <ellipse
          cx="282"
          cy="232"
          rx="14"
          ry="10"
          fill="url(#hero-skin)"
          transform="rotate(20 282 232)"
        />

        <ellipse cx="200" cy="160" rx="68" ry="62" fill="url(#hero-skin)" />
        <path
          d="M 130 160 Q 122 95 200 88 Q 278 95 270 160 Q 250 130 200 128 Q 150 130 130 160 Z"
          fill="url(#hero-clay)"
        />
        <path
          d="M 138 130 Q 158 100 200 96 Q 184 108 168 122 Q 152 130 142 142 Z"
          fill="rgba(255,255,255,0.30)"
        />
        <path
          d="M 174 168 Q 184 160 194 168"
          stroke="#2a232c"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 206 168 Q 216 160 226 168"
          stroke="#2a232c"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M 188 188 Q 200 196 212 188"
          stroke="#2a232c"
          strokeWidth="2.2"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="166" cy="180" rx="9" ry="4.5" fill="#FF9C7A" opacity="0.32" />
        <ellipse cx="234" cy="180" rx="9" ry="4.5" fill="#FF9C7A" opacity="0.32" />

        <path
          d="M 145 220 Q 200 250 255 220 Q 240 280 200 290 Q 160 280 145 220 Z"
          fill="url(#hero-baton)"
          opacity="0.25"
        />

        <g filter="blur(0.6px)">
          <circle cx="78" cy="208" r="11" fill="#B7A4F2" opacity="0.85" />
          <circle cx="76" cy="206" r="1.3" fill="#1a1822" />
          <circle cx="82" cy="206" r="1.3" fill="#1a1822" />
          <circle cx="58" cy="170" r="8" fill="#9DC4F2" opacity="0.78" />
          <circle cx="92" cy="160" r="9" fill="#FFB89A" opacity="0.85" />
          <circle cx="89" cy="158" r="1.1" fill="#1a1822" />
          <circle cx="95" cy="158" r="1.1" fill="#1a1822" />
          <circle cx="68" cy="138" r="7" fill="#C2E89A" opacity="0.70" />
        </g>
        <path
          d="M 100 220 Q 50 175 100 130"
          stroke="rgba(124,92,255,0.45)"
          strokeWidth="1"
          fill="none"
          strokeDasharray="2 4"
        />
      </svg>
    </div>
  );
};
