# Mascot assets

The `Mascot` component currently renders a procedural SVG sticker per role
(see `src/renderer/components/aurora/Mascot.tsx`). To swap in PNG art:

1. Generate one 512×512 PNG per role using the Pipeline A prompt in the
   redesign brief. Use the `descriptor` field in `manifest.json` as the
   role-specific prompt fragment.
2. Drop them in this folder as `lead.png`, `coder.png`, `reviewer.png`,
   `researcher.png`, `designer.png`, `ops.png` (and optionally `lead-128.png`
   etc. for the chip variant).
3. Update `manifest.json` to point each `png512` / `png128` field at the
   filename and fill in the `sha256` so we can detect drift.
4. Extend `Mascot.tsx` so that — when both the manifest entry and the PNG
   file exist for a role — it renders an `<img>` instead of the SVG. The
   procedural SVG remains the always-on fallback.

Because the contract (`role`, `size`, `seed`, `status`, `halo`) doesn't
change, no callers need to be touched. The status dot, halo, and
breathing animation all stay in the wrapper.
