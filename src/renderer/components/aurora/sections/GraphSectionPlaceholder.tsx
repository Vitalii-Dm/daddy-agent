import React from 'react';

// Reserved for the upcoming knowledge-graph view. Section is collapsed
// to zero height by default; commit 14 wires the visible glass placeholder.
export const GraphSectionPlaceholder = (): React.JSX.Element => (
  <section id="graph" aria-hidden="true" className="h-0 overflow-hidden" />
);
