/**
 * The feature graph behind the navigation menu.
 *
 * The edges are not decoration: they are the app's actual dataflow. Brief reads
 * all four feeds plus the handset's sensors; Sky reads the ISS fix, the
 * geomagnetic index and the device attitude. Drawing anything else would make a
 * diagram that lies about the system it navigates.
 *
 * Adding a feature means adding a node and its real dependencies here — the
 * layout, the edges and the pulses all follow from this one table.
 */

export type NodeId = 'index' | 'seismic' | 'aurora' | 'launch' | 'motion' | 'brief' | 'sky';

/** 0 = source, 1 = device, 2 = synthesis. Layout derives rows from this. */
export type Layer = 0 | 1 | 2;

export type FeatureNode = {
  id: NodeId;
  label: string;
  /** Route to push. */
  href: string;
  /** Params for routes that take them. */
  params?: Record<string, string>;
  layer: Layer;
  /** One line explaining what it is, shown on selection. */
  blurb: string;
  accent: string;
  /** True when the node is a tab; false for routes reached only from the menu. */
  isTab: boolean;
};

export const NODES: FeatureNode[] = [
  {
    id: 'index',
    label: 'Orbit',
    href: '/',
    layer: 0,
    blurb: 'ISS position, live from wheretheiss.at',
    accent: '#C6F24E',
    isTab: true,
  },
  {
    id: 'seismic',
    label: 'Seismic',
    href: '/seismic',
    layer: 0,
    blurb: 'USGS earthquakes, M2.5+ over 24 hours',
    accent: '#4EC8F2',
    isTab: true,
  },
  {
    id: 'aurora',
    label: 'Aurora',
    href: '/aurora',
    layer: 0,
    blurb: 'Planetary Kp index from NOAA SWPC',
    accent: '#3BE08A',
    isTab: true,
  },
  {
    id: 'launch',
    label: 'Launch',
    href: '/launch',
    layer: 0,
    blurb: 'Upcoming orbital launches, Launch Library 2',
    accent: '#F2C94E',
    isTab: true,
  },
  {
    id: 'motion',
    label: 'Motion',
    href: '/motion',
    layer: 1,
    blurb: 'Accelerometer, gyroscope and gesture input',
    accent: '#FF9F6B',
    isTab: true,
  },
  {
    id: 'brief',
    label: 'Brief',
    href: '/brief',
    layer: 2,
    blurb: 'Fuses every feed through a model you supply',
    accent: '#B36BFF',
    isTab: true,
  },
  {
    id: 'sky',
    label: 'Sky',
    href: '/sky',
    params: { mode: 'orbit' },
    layer: 2,
    blurb: 'AR star field with the ISS marked where it really is',
    accent: '#8CF7C0',
    isTab: false,
  },
];

/** [from, to] — a real data dependency, not a drawn line. */
export const EDGES: [NodeId, NodeId][] = [
  ['index', 'brief'],
  ['seismic', 'brief'],
  ['aurora', 'brief'],
  ['launch', 'brief'],
  ['motion', 'brief'],
  ['index', 'sky'],
  ['aurora', 'sky'],
  ['motion', 'sky'],
];

export const NODE_BY_ID = new Map(NODES.map((n) => [n.id, n]));

export type Point = { x: number; y: number };

/**
 * Places nodes on a normalised 0..1 canvas: one row per layer, evenly spread
 * across the width. Derived rather than hard-coded so a new feature lands
 * somewhere sensible without anyone repositioning the others.
 */
export function layout(nodes: FeatureNode[] = NODES): Map<NodeId, Point> {
  const byLayer = new Map<Layer, FeatureNode[]>();
  for (const n of nodes) {
    const list = byLayer.get(n.layer) ?? [];
    list.push(n);
    byLayer.set(n.layer, list);
  }

  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  const positions = new Map<NodeId, Point>();

  layers.forEach((layer, rowIndex) => {
    const row = byLayer.get(layer)!;
    // Rows are inset from the edges so glow and labels are never clipped.
    const y = layers.length === 1 ? 0.5 : 0.16 + (rowIndex / (layers.length - 1)) * 0.68;

    row.forEach((node, i) => {
      const x = row.length === 1 ? 0.5 : 0.14 + (i / (row.length - 1)) * 0.72;
      positions.set(node.id, { x, y });
    });
  });

  return positions;
}
