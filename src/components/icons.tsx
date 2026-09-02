import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';

/**
 * A small, deliberately hand-drawn icon set.
 *
 * Construction follows Material's discipline — a strict 24×24 grid, uniform 1.9
 * stroke, geometry built from circles and straight runs — while the finish
 * follows Apple's: round caps and joins everywhere, optical rather than
 * mathematical centring, and no fill except where a shape must read as solid.
 *
 * They inherit `color` so a parent can tint them, the way SF Symbols do.
 */

export type IconProps = {
  size?: number;
  color?: string;
  /** Thicker stroke for the selected state, like SF Symbols' weight axis. */
  active?: boolean;
};

const STROKE = 1.9;
const STROKE_ACTIVE = 2.4;

function useStroke(active?: boolean) {
  return active ? STROKE_ACTIVE : STROKE;
}

/** Orbit: a tilted orbital ring around a solid body. */
export function OrbitIcon({ size = 22, color = 'currentColor', active }: IconProps) {
  const w = useStroke(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G rotation={-26} origin="12, 12">
        <Ellipse cx="12" cy="12" rx="10" ry="4.4" stroke={color} strokeWidth={w} />
      </G>
      <Circle cx="12" cy="12" r="3.1" fill={color} />
    </Svg>
  );
}

/** Seismic: a seismograph trace, quiet at the edges and violent in the middle. */
export function SeismicIcon({ size = 22, color = 'currentColor', active }: IconProps) {
  const w = useStroke(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M1.5 12h3.2l2.1-5.6 2.9 11.4 2.4-8.2 1.8 4.1 1.5-2.3h7.1"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Motion: a tilted device with its bubble off-centre, plus motion ticks. */
export function MotionIcon({ size = 22, color = 'currentColor', active }: IconProps) {
  const w = useStroke(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G rotation={-16} origin="10, 12">
        <Rect
          x="3.6"
          y="3.4"
          width="12.8"
          height="17.2"
          rx="3.4"
          stroke={color}
          strokeWidth={w}
        />
        <Circle cx="12.6" cy="9.4" r="2" fill={color} />
      </G>
      {/* Two ticks reading as displacement, weighted like a signal falling off. */}
      <Path
        d="M20 8.6c1.5 2.2 1.5 4.6 0 6.8"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Aurora: banded curtains of light over a horizon. */
export function AuroraIcon({ size = 22, color = 'currentColor', active }: IconProps) {
  const w = useStroke(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Three nested arcs, weight falling off outward like a real curtain. */}
      <Path
        d="M4 17c0-5.2 3.4-9 8-9s8 3.8 8 9"
        stroke={color}
        strokeWidth={w}
        strokeLinecap="round"
      />
      <Path
        d="M7.6 18.2c0-3.6 1.9-6.4 4.4-6.4s4.4 2.8 4.4 6.4"
        stroke={color}
        strokeWidth={w * 0.82}
        strokeLinecap="round"
      />
      <Path d="M3 21h18" stroke={color} strokeWidth={w * 0.7} strokeLinecap="round" />
    </Svg>
  );
}

/** Launch: a vehicle ascending on a plume. */
export function LaunchIcon({ size = 22, color = 'currentColor', active }: IconProps) {
  const w = useStroke(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5c2.6 2.4 4 5.6 4 9v3.2H8V11.5c0-3.4 1.4-6.6 4-9Z"
        stroke={color}
        strokeWidth={w}
        strokeLinejoin="round"
      />
      <Circle cx="12" cy="10" r="1.9" fill={color} />
      {/* Fins, then the plume: shorter strokes read as thrust at small sizes. */}
      <Path
        d="M8 12.6 5.4 15v2.6h2.4M16 12.6 18.6 15v2.6h-2.4"
        stroke={color}
        strokeWidth={w * 0.85}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M10.4 18.6v2.6M13.6 18.6v2.6M12 19.4V22"
        stroke={color}
        strokeWidth={w * 0.85}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Brief: a neural fan-in — several feeds converging on one node. */
export function BriefIcon({ size = 22, color = 'currentColor', active }: IconProps) {
  const w = useStroke(active);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {/* Three inputs on the left converging into a single output node. */}
      <Path
        d="M5.5 5.5 12 12M5.5 12H12M5.5 18.5 12 12"
        stroke={color}
        strokeWidth={w * 0.85}
        strokeLinecap="round"
      />
      <Path d="M12 12h6.5" stroke={color} strokeWidth={w} strokeLinecap="round" />
      <Circle cx="4.4" cy="5.5" r="1.7" fill={color} />
      <Circle cx="4.4" cy="12" r="1.7" fill={color} />
      <Circle cx="4.4" cy="18.5" r="1.7" fill={color} />
      <Circle cx="12" cy="12" r="2.6" stroke={color} strokeWidth={w} />
      <Circle cx="19.8" cy="12" r="1.7" fill={color} />
    </Svg>
  );
}

/** The app mark, matching the launcher icon: uplink arcs crossed by an orbit. */
export function UplinkMark({
  size = 40,
  signal = '#C6F24E',
  orbit = '#4EC8F2',
}: {
  size?: number;
  signal?: string;
  orbit?: string;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      <G rotation={-26} origin="24, 22">
        <Ellipse cx="24" cy="22" rx="19" ry="8" stroke={orbit} strokeWidth={3.2} />
      </G>
      {/* Arcs sweep the north-east quadrant from a solid core at lower-left. */}
      {[
        { r: 8, w: 3.9 },
        { r: 15, w: 3.2 },
        { r: 22, w: 2.6 },
      ].map(({ r, w }) => (
        <Path
          key={r}
          d={`M ${12 + r * Math.cos((-78 * Math.PI) / 180)} ${
            34 + r * Math.sin((-78 * Math.PI) / 180)
          } A ${r} ${r} 0 0 1 ${12 + r * Math.cos((-4 * Math.PI) / 180)} ${
            34 + r * Math.sin((-4 * Math.PI) / 180)
          }`}
          stroke={signal}
          strokeWidth={w}
          strokeLinecap="round"
        />
      ))}
      <Circle cx="12" cy="34" r="3.1" fill={signal} />
    </Svg>
  );
}

export const TAB_ICONS = {
  index: OrbitIcon,
  seismic: SeismicIcon,
  aurora: AuroraIcon,
  launch: LaunchIcon,
  motion: MotionIcon,
  brief: BriefIcon,
} as const;
