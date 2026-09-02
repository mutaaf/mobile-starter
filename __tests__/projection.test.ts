import {
  cameraBasis,
  edgeIndicator,
  project,
  separateEdgeIndicators,
  starOpacity,
  starRadius,
  toUnitVector,
} from '@/lib/sky/projection';

const VIEWPORT = { width: 400, height: 800, fovX: 62 };

describe('toUnitVector', () => {
  it('maps the cardinal directions onto the east/north/up axes', () => {
    expect(toUnitVector({ altitude: 0, azimuth: 0 })).toEqual([
      expect.closeTo(0, 6), expect.closeTo(1, 6), expect.closeTo(0, 6),
    ]);
    expect(toUnitVector({ altitude: 0, azimuth: 90 })).toEqual([
      expect.closeTo(1, 6), expect.closeTo(0, 6), expect.closeTo(0, 6),
    ]);
    expect(toUnitVector({ altitude: 90, azimuth: 0 })).toEqual([
      expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(1, 6),
    ]);
  });
});

describe('cameraBasis', () => {
  it('faces north with east to the right when heading is zero and level', () => {
    const { forward, right, up } = cameraBasis({ heading: 0, elevation: 0 });
    expect(forward).toEqual([expect.closeTo(0, 6), expect.closeTo(1, 6), expect.closeTo(0, 6)]);
    expect(right).toEqual([expect.closeTo(1, 6), expect.closeTo(0, 6), expect.closeTo(0, 6)]);
    expect(up).toEqual([expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(1, 6)]);
  });

  it('looks at the zenith when elevation is 90', () => {
    const { forward } = cameraBasis({ heading: 0, elevation: 90 });
    expect(forward[2]).toBeCloseTo(1, 6);
  });

  it('keeps right in the horizontal plane at any elevation', () => {
    // Otherwise the drawn horizon tilts as the user raises the phone.
    for (const elevation of [-60, 0, 45, 89]) {
      expect(cameraBasis({ heading: 210, elevation }).right[2]).toBeCloseTo(0, 9);
    }
  });
});

describe('project', () => {
  const view = { heading: 90, elevation: 20 };

  it('puts a target at the centre of view at the centre of frame', () => {
    const p = project({ altitude: 20, azimuth: 90 }, view, VIEWPORT);
    expect(p.x).toBeCloseTo(VIEWPORT.width / 2, 4);
    expect(p.y).toBeCloseTo(VIEWPORT.height / 2, 4);
    expect(p.onScreen).toBe(true);
    expect(p.offAxis).toBeCloseTo(0, 4);
  });

  it('places a target clockwise in azimuth to the right of centre', () => {
    const p = project({ altitude: 20, azimuth: 105 }, view, VIEWPORT);
    expect(p.x).toBeGreaterThan(VIEWPORT.width / 2);
  });

  it('places a higher target above centre', () => {
    // Screen y grows downward, so "higher in the sky" means a smaller y.
    const p = project({ altitude: 35, azimuth: 90 }, view, VIEWPORT);
    expect(p.y).toBeLessThan(VIEWPORT.height / 2);
  });

  it('rejects a target behind the camera instead of mirroring it into frame', () => {
    const p = project({ altitude: 20, azimuth: 270 }, view, VIEWPORT);
    expect(p.onScreen).toBe(false);
    expect(p.offAxis).toBeGreaterThan(90);
  });

  it('marks a target just outside the frame as off-screen', () => {
    const p = project({ altitude: 20, azimuth: 90 + 60 }, view, VIEWPORT);
    expect(p.onScreen).toBe(false);
  });

  it('reports off-axis angle independently of framing', () => {
    const p = project({ altitude: 20, azimuth: 120 }, view, VIEWPORT);
    // 30 degrees of azimuth at 20 degrees altitude is a little under 30 of arc.
    expect(p.offAxis).toBeGreaterThan(24);
    expect(p.offAxis).toBeLessThan(30);
  });

  it('scales with field of view — a narrower lens pushes targets outward', () => {
    const wide = project({ altitude: 20, azimuth: 105 }, view, { ...VIEWPORT, fovX: 90 });
    const narrow = project({ altitude: 20, azimuth: 105 }, view, { ...VIEWPORT, fovX: 40 });
    expect(narrow.x).toBeGreaterThan(wide.x);
  });
});

describe('star appearance', () => {
  it('draws brighter stars larger', () => {
    expect(starRadius(-1.46)).toBeGreaterThan(starRadius(1.0));
    expect(starRadius(1.0)).toBeGreaterThan(starRadius(3.0));
  });

  it('never collapses a faint star to nothing', () => {
    expect(starRadius(6)).toBeGreaterThan(0);
    expect(starOpacity(6)).toBeGreaterThan(0);
  });

  it('caps opacity at fully opaque for the brightest stars', () => {
    expect(starOpacity(-1.46)).toBeLessThanOrEqual(1);
  });
});

describe('edgeIndicator', () => {
  const W = 400;
  const H = 800;

  it('pins to the right edge for a target to the right', () => {
    const e = edgeIndicator(60, 0, W, H);
    expect(e.x).toBeCloseTo(W - 34, 4);
    expect(e.y).toBeCloseTo(H / 2, 4);
    expect(e.rotation).toBeCloseTo(0, 4);
  });

  it('pins to the left edge for a target behind to the left', () => {
    const e = edgeIndicator(-140, 0, W, H);
    expect(e.x).toBeCloseTo(34, 4);
    expect(Math.abs(e.rotation)).toBeCloseTo(180, 4);
  });

  it('pins to the top edge for a target overhead', () => {
    const e = edgeIndicator(0, 70, W, H);
    expect(e.y).toBeCloseTo(34, 4);
    expect(e.x).toBeCloseTo(W / 2, 4);
    // Rotation is measured for a right-pointing chevron, so "up" is -90.
    expect(e.rotation).toBeCloseTo(-90, 4);
  });

  it('pins to the bottom edge for a target below the horizon behind you', () => {
    const e = edgeIndicator(0, -50, W, H);
    expect(e.y).toBeCloseTo(H - 34, 4);
    expect(e.rotation).toBeCloseTo(90, 4);
  });

  it('always lands on a border, never inside the frame', () => {
    for (let az = -175; az <= 180; az += 15) {
      for (const alt of [-80, -20, 0, 25, 85]) {
        const e = edgeIndicator(az, alt, W, H);
        const onVertical = Math.abs(e.x - 34) < 0.01 || Math.abs(e.x - (W - 34)) < 0.01;
        const onHorizontal = Math.abs(e.y - 34) < 0.01 || Math.abs(e.y - (H - 34)) < 0.01;
        expect(onVertical || onHorizontal).toBe(true);
      }
    }
  });

  it('uses the angular direction, not a projection, for targets behind the camera', () => {
    // 179 degrees away is behind and slightly right; 181 (i.e. -179) is behind
    // and slightly left. They must not both collapse to the same edge.
    const right = edgeIndicator(179, 0, W, H);
    const left = edgeIndicator(-179, 0, W, H);
    expect(right.x).toBeGreaterThan(W / 2);
    expect(left.x).toBeLessThan(W / 2);
  });
});

describe('separateEdgeIndicators', () => {
  const W = 400;
  const H = 800;

  it('pushes overlapping markers apart', () => {
    const stacked = [
      { x: W - 34, y: 400, rotation: 0 },
      { x: W - 34, y: 404, rotation: 0 },
      { x: W - 34, y: 408, rotation: 0 },
    ];
    const spread = separateEdgeIndicators(stacked, W, H, 50);

    const ys = spread.map((m) => m.y).sort((a, b) => a - b);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(49.9);
    }
  });

  it('leaves well-separated markers alone', () => {
    const fine = [
      { x: W - 34, y: 120, rotation: 0 },
      { x: W - 34, y: 400, rotation: 0 },
    ];
    expect(separateEdgeIndicators(fine, W, H, 50)).toEqual(fine);
  });

  it('keeps every marker inside the frame after spreading', () => {
    const crowded = Array.from({ length: 8 }, (_, i) => ({
      x: W - 34,
      y: H - 60 + i,
      rotation: 0,
    }));
    for (const m of separateEdgeIndicators(crowded, W, H, 56)) {
      expect(m.y).toBeGreaterThanOrEqual(34);
      expect(m.y).toBeLessThanOrEqual(H - 34);
    }
  });

  it('separates each border side independently', () => {
    const mixed = [
      { x: 34, y: 300, rotation: 180 },
      { x: W - 34, y: 300, rotation: 0 },
    ];
    // Opposite sides never overlap, so neither should move.
    expect(separateEdgeIndicators(mixed, W, H, 90)).toEqual(mixed);
  });
});
