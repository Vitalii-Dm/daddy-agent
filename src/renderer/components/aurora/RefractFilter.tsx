import React from 'react';

// Single SVG filter referenced by `glassClasses({ refract: true })`. Mount once
// near the root of the Aurora shell. The displacement is intentionally subtle —
// crank `scale` if the user enables a "high refraction" preference later.
export const RefractFilter = (): React.JSX.Element => (
  <svg width="0" height="0" className="absolute" aria-hidden="true" focusable="false">
    <filter id="lg-refract" x="0%" y="0%" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.008 0.012" numOctaves="2" seed="7" />
      <feDisplacementMap in="SourceGraphic" scale="14" xChannelSelector="R" yChannelSelector="G" />
    </filter>
  </svg>
);
