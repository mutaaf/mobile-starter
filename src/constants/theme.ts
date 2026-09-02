import '@/global.css';

/**
 * Ground Station is a single-theme app on purpose: an instrument console reads
 * as an instrument console, and a light variant would undermine that. Colors are
 * flat constants rather than a light/dark pair.
 */
export const Palette = {
  /** Page ground. Near-black, very slightly blue. */
  void: '#08090B',
  /** Raised panel. */
  panel: '#0F1319',
  /** Panel one step brighter, for nested rows. */
  panelHi: '#151A22',
  /** Hairline rules and panel borders. */
  rule: '#212832',

  text: '#E8EDF2',
  /** Labels, units, secondary readouts. */
  dim: '#69747F',
  /** Barely-there text: axis ticks, disabled states. */
  faint: '#3A434E',

  /** The single accent. Used sparingly — live values, active states. */
  signal: '#C6F24E',
  /** Warnings and high-magnitude events. */
  alert: '#FF6B4A',
  /** Informational, non-urgent highlight. */
  cool: '#4EC8F2',
} as const;

export const Type = {
  /** Condensed display face for headings and big numerals. */
  display: 'ArchivoBlack_400Regular',
  mono: 'IBMPlexMono_400Regular',
  monoMedium: 'IBMPlexMono_500Medium',
  monoBold: 'IBMPlexMono_700Bold',
} as const;

/** 4pt base scale. */
export const Space = {
  hair: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
} as const;

export const Radius = {
  sm: 4,
  md: 8,
  lg: 14,
} as const;

/** Tab bar height plus breathing room, so content never sits under it. */
export const BottomTabInset = 64;
export const MaxContentWidth = 720;
