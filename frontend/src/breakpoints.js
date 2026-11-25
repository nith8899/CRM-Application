// Mirrors --bp-* in design-tokens.md. Use these in JS (matchMedia); CSS media queries use the same numbers.
export const BP = { sm: 640, md: 980, lg: 1280 };
export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
