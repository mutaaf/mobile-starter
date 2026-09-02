/**
 * The landing page's live sky.
 *
 * This is a port of src/lib/sky/astro.ts and src/lib/sky/projection.ts — the same
 * functions the app runs, against the same keyless API the app calls
 * (api.wheretheiss.at). Nothing here is a mock or a canned animation: the ISS is
 * where the ISS is, and the stars are where they are for whoever is reading.
 *
 * Ported rather than shared because the app's copy is TypeScript compiled by
 * Metro, and adding a bundler to a static page to avoid ~120 lines of duplication
 * would be a bad trade. The catalogue, which is the part that actually grows, IS
 * generated from the app's source — see scripts/build-landing-data.py.
 */
(function () {
  'use strict';

  var DEG = Math.PI / 180;
  var RAD = 180 / Math.PI;
  var EARTH_RADIUS_KM = 6378.137;
  var FLATTENING = 1 / 298.257223563;
  var E2 = FLATTENING * (2 - FLATTENING);
  /**
   * Field of view.
   *
   * The app uses fovX = 62°, which on a tall phone works out to about 105° of
   * *vertical* sky. A landscape browser canvas at the same fovX would show barely
   * 40° vertically — a nearly empty rectangle, which misrepresents what the app
   * looks like rather than matching it. So the vertical angle is what is held
   * constant here, and the horizontal one follows from the canvas shape.
   */
  var FOV_Y = 72;
  var FOV_MAX_X = 110; // gnomonic projection stretches badly past this

  function fovX(vp) {
    var focal = vp.height / 2 / Math.tan((FOV_Y * DEG) / 2);
    return Math.min(FOV_MAX_X, 2 * Math.atan(vp.width / 2 / focal) * RAD);
  }

  // ------------------------------------------------------------------ astro

  function normalizeDegrees(d) {
    return ((d % 360) + 360) % 360;
  }

  function greenwichMeanSiderealTime(at) {
    var jd = at.getTime() / 86400000 + 2440587.5;
    var d = jd - 2451545.0;
    var t = d / 36525;
    return normalizeDegrees(
      280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000
    );
  }

  function equatorialToHorizontal(ra, dec, observer, at) {
    var lst = normalizeDegrees(greenwichMeanSiderealTime(at) + observer.longitude);
    var ha = normalizeDegrees(lst - ra) * DEG;
    var d = dec * DEG;
    var lat = observer.latitude * DEG;

    var sinAlt = Math.sin(d) * Math.sin(lat) + Math.cos(d) * Math.cos(lat) * Math.cos(ha);
    var altitude = Math.asin(Math.max(-1, Math.min(1, sinAlt)));

    // atan2 rather than acos: stable at the poles, and the quadrant falls out.
    var azimuth = Math.atan2(
      -Math.cos(d) * Math.sin(ha),
      Math.sin(d) * Math.cos(lat) - Math.cos(d) * Math.sin(lat) * Math.cos(ha)
    );

    return { altitude: altitude * RAD, azimuth: normalizeDegrees(azimuth * RAD) };
  }

  function geodeticToEcef(latitude, longitude, altitudeKm) {
    var lat = latitude * DEG;
    var lon = longitude * DEG;
    var sinLat = Math.sin(lat);
    var n = EARTH_RADIUS_KM / Math.sqrt(1 - E2 * sinLat * sinLat);
    return {
      x: (n + altitudeKm) * Math.cos(lat) * Math.cos(lon),
      y: (n + altitudeKm) * Math.cos(lat) * Math.sin(lon),
      z: (n * (1 - E2) + altitudeKm) * sinLat,
    };
  }

  function satelliteLookAngle(observer, satellite) {
    var obs = geodeticToEcef(observer.latitude, observer.longitude, 0);
    var sat = geodeticToEcef(satellite.latitude, satellite.longitude, satellite.altitudeKm);

    var dx = sat.x - obs.x;
    var dy = sat.y - obs.y;
    var dz = sat.z - obs.z;

    var lat = observer.latitude * DEG;
    var lon = observer.longitude * DEG;
    var sinLat = Math.sin(lat);
    var cosLat = Math.cos(lat);
    var sinLon = Math.sin(lon);
    var cosLon = Math.cos(lon);

    var east = -sinLon * dx + cosLon * dy;
    var north = -sinLat * cosLon * dx - sinLat * sinLon * dy + cosLat * dz;
    var up = cosLat * cosLon * dx + cosLat * sinLon * dy + sinLat * dz;

    var rangeKm = Math.sqrt(east * east + north * north + up * up);
    var altitude = Math.asin(up / rangeKm) * RAD;

    return {
      altitude: altitude,
      azimuth: normalizeDegrees(Math.atan2(east, north) * RAD),
      rangeKm: rangeKm,
      visible: altitude > 0,
    };
  }

  function angularDelta(from, to) {
    var delta = normalizeDegrees(to - from);
    return delta > 180 ? delta - 360 : delta;
  }

  var COMPASS = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  function compassPoint(az) {
    return COMPASS[Math.round(normalizeDegrees(az) / 22.5) % 16];
  }

  function starColor(bv) {
    var c = Math.max(-0.3, Math.min(2.0, bv));
    if (c < 0.0) return '#A9C4FF';
    if (c < 0.3) return '#D6E4FF';
    if (c < 0.6) return '#F5F3EC';
    if (c < 1.0) return '#FFE9B8';
    if (c < 1.5) return '#FFCE8A';
    return '#FFAE6B';
  }

  // ------------------------------------------------------------- projection

  function toUnitVector(h) {
    var alt = h.altitude * DEG;
    var az = h.azimuth * DEG;
    var cosAlt = Math.cos(alt);
    return [cosAlt * Math.sin(az), cosAlt * Math.cos(az), Math.sin(alt)];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function cameraBasis(view) {
    var h = view.heading * DEG;
    var e = view.elevation * DEG;
    var cosE = Math.cos(e);
    var sinE = Math.sin(e);
    var sinH = Math.sin(h);
    var cosH = Math.cos(h);
    return {
      forward: [cosE * sinH, cosE * cosH, sinE],
      right: [cosH, -sinH, 0],
      up: [-sinH * sinE, -cosH * sinE, cosE],
    };
  }

  /** Gnomonic, matching the app: rectilinear, the way a camera lens actually is. */
  function project(target, view, vp) {
    var s = toUnitVector(target);
    var b = cameraBasis(view);
    var z = dot(s, b.forward);

    // Behind the camera. Projecting anyway mirrors it into frame as a ghost.
    if (z <= 1e-6) return { x: 0, y: 0, onScreen: false };

    var focal = vp.width / 2 / Math.tan((fovX(vp) * DEG) / 2);
    var x = vp.width / 2 + (dot(s, b.right) / z) * focal;
    var y = vp.height / 2 - (dot(s, b.up) / z) * focal;
    var m = 24;
    return {
      x: x,
      y: y,
      onScreen: x >= -m && x <= vp.width + m && y >= -m && y <= vp.height + m,
    };
  }

  function starRadius(mag) {
    return Math.max(0.7, 3.4 - mag * 0.62);
  }

  function starOpacity(mag) {
    return Math.max(0.35, Math.min(1, 1.05 - mag * 0.16));
  }

  /**
   * Border marker aiming at an off-screen target.
   *
   * Driven by the angular deltas, not by the projected point: a target behind
   * the camera has no meaningful projection, and using one sends the arrow to
   * the opposite edge — the most confusing thing an off-screen indicator can do.
   */
  var EDGE_INSET = 34;

  function edgeIndicator(dAz, dAlt, width, height) {
    var cx = width / 2;
    var cy = height / 2;
    // Screen y grows downward, so a target above the view goes up: negate dAlt.
    var angle = Math.atan2(-dAlt, dAz);
    var halfW = Math.max(1, cx - EDGE_INSET);
    var halfH = Math.max(1, cy - EDGE_INSET);
    var cos = Math.cos(angle);
    var sin = Math.sin(angle);
    // Scale the ray until it meets whichever border it reaches first.
    var tx = Math.abs(cos) < 1e-6 ? Infinity : halfW / Math.abs(cos);
    var ty = Math.abs(sin) < 1e-6 ? Infinity : halfH / Math.abs(sin);
    var t = Math.min(tx, ty);
    return { x: cx + cos * t, y: cy + sin * t, rotation: angle * RAD };
  }

  /**
   * Spreads markers that land on top of each other.
   *
   * Objects in similar directions produce nearly identical border points, and
   * two stacked chevrons are worse than one — neither label is readable. Each
   * side is treated as a 1-D track and pushed apart to a minimum gap, order
   * preserved so the arrangement still reflects the sky.
   */
  function separateEdgeIndicators(markers, width, height, minGap) {
    minGap = minGap || 74;
    var groups = {};

    markers.forEach(function (m) {
      var key;
      if (Math.abs(m.y - EDGE_INSET) < 0.5) key = 'top';
      else if (Math.abs(m.y - (height - EDGE_INSET)) < 0.5) key = 'bottom';
      else key = m.x < width / 2 ? 'left' : 'right';
      (groups[key] = groups[key] || []).push(m);
    });

    Object.keys(groups).forEach(function (key) {
      var list = groups[key];
      var horizontal = key === 'top' || key === 'bottom';
      var axis = horizontal ? 'x' : 'y';
      var limit = horizontal ? width : height;

      list.sort(function (a, b) { return a[axis] - b[axis]; });

      // Forward pass opens gaps, backward pass pulls the tail back into frame.
      for (var i = 1; i < list.length; i++) {
        if (list[i][axis] - list[i - 1][axis] < minGap) {
          list[i][axis] = list[i - 1][axis] + minGap;
        }
      }
      for (var j = list.length - 1; j >= 0; j--) {
        var max = limit - EDGE_INSET;
        if (list[j][axis] > max) list[j][axis] = max;
        if (j > 0 && list[j][axis] - list[j - 1][axis] < minGap) {
          list[j - 1][axis] = list[j][axis] - minGap;
        }
      }
      list.forEach(function (m) {
        if (m[axis] < EDGE_INSET) m[axis] = EDGE_INSET;
      });
    });

    return markers;
  }

  // ------------------------------------------------------------------- view

  var DEFAULT_OBSERVER = { latitude: 51.4779, longitude: 0 }; // Greenwich

  function SkyView(canvas, opts) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.observer = DEFAULT_OBSERVER;
    this.observerLabel = 'Greenwich (default)';
    this.iss = null;
    this.view = { heading: 0, elevation: 18 };
    this.locked = null;
    this.dragging = false;
    this.onState = (opts && opts.onState) || function () {};
    this.reduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    this.stars = (window.SKY_DATA && window.SKY_DATA.stars) || [];
    this.figures = (window.SKY_DATA && window.SKY_DATA.figures) || [];
    this.byName = {};
    for (var i = 0; i < this.stars.length; i++) this.byName[this.stars[i].name] = this.stars[i];

    this._bind();
    this._resize();
  }

  SkyView.prototype._bind = function () {
    var self = this;
    var last = null;

    window.addEventListener('resize', function () {
      self._resize();
    });

    function down(e) {
      self.dragging = true;
      last = point(e);
      self.canvas.style.cursor = 'grabbing';
    }
    function move(e) {
      if (!self.dragging || !last) return;
      var p = point(e);
      var dx = p.x - last.x;
      var dy = p.y - last.y;
      last = p;
      if (Math.abs(dx) + Math.abs(dy) > 2) {
        // Dragging is intent to look elsewhere, so it releases the lock —
        // exactly as it does in the app.
        self.locked = null;
        self.moved = true;
        self.touched = true;
      }
      var w = self.canvas.clientWidth || 1;
      var h = self.canvas.clientHeight || 1;
      self.view.heading = normalizeDegrees(self.view.heading - (dx / w) * fovX({ width: w, height: h }));
      self.view.elevation = Math.max(-89, Math.min(89, self.view.elevation + (dy / h) * FOV_Y));
      e.preventDefault();
    }
    function up() {
      self.dragging = false;
      last = null;
      self.canvas.style.cursor = 'grab';
    }
    function point(e) {
      var t = e.touches && e.touches[0] ? e.touches[0] : e;
      return { x: t.clientX, y: t.clientY };
    }

    this.canvas.addEventListener('mousedown', down);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    this.canvas.addEventListener('touchstart', down, { passive: true });
    this.canvas.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', up);

    this.canvas.addEventListener('click', function (e) {
      if (self.moved) {
        self.moved = false;
        return;
      }
      var rect = self.canvas.getBoundingClientRect();
      self._tap(e.clientX - rect.left, e.clientY - rect.top);
    });
  };

  SkyView.prototype._resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = this.canvas.clientWidth;
    var h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  /** Every labelled thing in the sky right now, targets first. */
  SkyView.prototype._objects = function (at) {
    var out = [];
    if (this.iss) {
      var look = satelliteLookAngle(this.observer, {
        latitude: this.iss.latitude,
        longitude: this.iss.longitude,
        altitudeKm: this.iss.altitude,
      });
      out.push({
        id: 'iss',
        label: 'ISS',
        color: '#c6f24e',
        target: true,
        direction: { altitude: look.altitude, azimuth: look.azimuth },
        rangeKm: look.rangeKm,
        visible: look.visible,
      });
    }
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      if (s.mag > 1.7) continue; // naming every star turns the sky into a word cloud
      out.push({
        id: 'star-' + s.name,
        label: s.name,
        color: starColor(s.bv),
        target: false,
        direction: equatorialToHorizontal(s.ra, s.dec, this.observer, at),
      });
    }
    return out;
  };

  SkyView.prototype._tap = function (x, y) {
    var at = new Date();
    var vp = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    var objects = this._objects(at);
    var best = null;
    var bestD = 44 * 44;

    for (var i = 0; i < objects.length; i++) {
      var p = project(objects[i].direction, this.view, vp);
      if (!p.onScreen) continue;
      var d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = objects[i];
      }
    }

    // Nothing under the finger: if the ISS is off frame, treat the tap as
    // "take me to it" rather than doing nothing.
    if (!best) {
      var iss = objects[0] && objects[0].id === 'iss' ? objects[0] : null;
      if (iss) best = iss;
    }
    if (best) this.lock(best.id);
  };

  SkyView.prototype.lock = function (id) {
    this.locked = id;
    this.touched = true;
  };

  /**
   * Points the view at the highest bright star in the observer's sky right now.
   *
   * An arbitrary starting heading is empty about half the time — the sky really
   * is mostly nothing — and an empty black rectangle is a bad first impression
   * of a working star field. This is still honest: it aims at something that is
   * genuinely up there, for whoever happens to be reading.
   */
  SkyView.prototype.aimAtSomethingGood = function () {
    var at = new Date();
    var vp = { width: this.canvas.clientWidth || 900, height: this.canvas.clientHeight || 420 };

    // Everything currently above the horizon, computed once.
    var up = [];
    for (var i = 0; i < this.stars.length; i++) {
      var d = equatorialToHorizontal(this.stars[i].ra, this.stars[i].dec, this.observer, at);
      if (d.altitude > 2) up.push({ star: this.stars[i], dir: d });
    }
    if (!up.length) return;

    // Aim where the sky is actually busy. An arbitrary heading is empty about
    // half the time — the sky really is mostly nothing — and an empty black
    // rectangle is a poor advert for a working star field. Still honest: it
    // points at real stars that are really up, for whoever is reading.
    var best = null;
    for (var c = 0; c < up.length; c++) {
      if (up[c].star.mag > 2.2) continue;
      var candidate = {
        heading: up[c].dir.azimuth,
        elevation: Math.max(8, Math.min(58, up[c].dir.altitude)),
      };
      var score = 0;
      for (var j = 0; j < up.length; j++) {
        if (!project(up[j].dir, candidate, vp).onScreen) continue;
        score += Math.max(0.5, 3 - up[j].star.mag);
      }
      if (!best || score > best.score) best = { score: score, view: candidate };
    }

    if (best) this.view = best.view;
  };

  SkyView.prototype.release = function () {
    this.locked = null;
  };

  SkyView.prototype.setObserver = function (observer, label) {
    this.observer = observer;
    this.observerLabel = label;
  };

  SkyView.prototype.setIss = function (iss) {
    this.iss = iss;
  };

  SkyView.prototype.frame = function () {
    var at = new Date();
    var vp = { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    if (vp.width < 2 || vp.height < 2) return;

    var objects = this._objects(at);

    // A locked target keeps tracking as it moves, so the view follows the ISS
    // across the sky rather than freezing where it was when you tapped.
    if (this.locked) {
      for (var i = 0; i < objects.length; i++) {
        if (objects[i].id === this.locked) {
          this.view.heading = objects[i].direction.azimuth;
          this.view.elevation = Math.max(-89, Math.min(89, objects[i].direction.altitude));
          break;
        }
      }
    }

    this._draw(at, vp, objects);

    var iss = objects.length && objects[0].id === 'iss' ? objects[0] : null;
    this.onState({
      heading: this.view.heading,
      elevation: this.view.elevation,
      compass: compassPoint(this.view.heading),
      locked: this.locked,
      iss: iss,
      observerLabel: this.observerLabel,
    });
  };

  SkyView.prototype._draw = function (at, vp, objects) {
    var ctx = this.ctx;
    var w = vp.width;
    var h = vp.height;

    ctx.clearRect(0, 0, w, h);

    // Sky gradient: darker overhead, a faint airglow toward the horizon.
    var horizonY = project({ altitude: 0, azimuth: this.view.heading }, this.view, vp);
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#05070b');
    g.addColorStop(1, '#0a1018');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    this._drawFigures(at, vp);
    this._drawStars(at, vp);

    // Horizon line, if it is in frame at all.
    if (horizonY.onScreen) {
      ctx.strokeStyle = 'rgba(78,200,242,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, horizonY.y);
      ctx.lineTo(w, horizonY.y);
      ctx.stroke();

      ctx.fillStyle = 'rgba(78,200,242,0.55)';
      ctx.font = '9px "IBM Plex Mono", monospace';
      // The control pills sit bottom-left, so the caption goes to the right and
      // flips above or below the line depending on where the line is.
      ctx.textAlign = 'right';
      ctx.fillText('HORIZON', w - 12, horizonY.y > h - 40 ? horizonY.y - 8 : horizonY.y + 14);
      ctx.textAlign = 'left';
    }

    this._drawLabels(vp, objects);
  };

  SkyView.prototype._drawStars = function (at, vp) {
    var ctx = this.ctx;
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      var dir = equatorialToHorizontal(s.ra, s.dec, this.observer, at);
      if (dir.altitude < -3) continue;
      var p = project(dir, this.view, vp);
      if (!p.onScreen) continue;

      var r = starRadius(s.mag);
      ctx.globalAlpha = starOpacity(s.mag);
      ctx.fillStyle = starColor(s.bv);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();

      // The brightest few get a soft bloom; all of them would read as fog.
      if (s.mag < 1.0) {
        ctx.globalAlpha = 0.16;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  };

  SkyView.prototype._drawFigures = function (at, vp) {
    var ctx = this.ctx;
    ctx.strokeStyle = 'rgba(120,150,190,0.26)';
    ctx.lineWidth = 1;

    for (var f = 0; f < this.figures.length; f++) {
      var lines = this.figures[f].lines;
      for (var l = 0; l < lines.length; l++) {
        var a = this.byName[lines[l][0]];
        var b = this.byName[lines[l][1]];
        if (!a || !b) continue;
        var pa = project(equatorialToHorizontal(a.ra, a.dec, this.observer, at), this.view, vp);
        var pb = project(equatorialToHorizontal(b.ra, b.dec, this.observer, at), this.view, vp);
        if (!pa.onScreen && !pb.onScreen) continue;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }
    }
  };

  SkyView.prototype._drawLabels = function (vp, objects) {
    var ctx = this.ctx;
    ctx.font = '10px "IBM Plex Mono", monospace';

    // Off-frame objects are collected first and then thinned. Drawing a chevron
    // for every one of them fills the border and stops it meaning anything.
    var offScreen = [];

    for (var i = 0; i < objects.length; i++) {
      var o = objects[i];
      var p = project(o.direction, this.view, vp);

      if (p.onScreen) {
        var isLocked = this.locked === o.id;

        if (o.target) {
          // The station gets a reticle, so it reads as a tracked object rather
          // than a brighter star.
          ctx.strokeStyle = o.color;
          ctx.lineWidth = isLocked ? 1.6 : 1.2;
          ctx.globalAlpha = 0.9;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = o.color;
          ctx.globalAlpha = 0.18;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 26, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;

          ctx.fillStyle = o.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }

        var text = o.label + (o.target ? '  ' + Math.round(o.direction.altitude) + '°' : '');
        var pad = 4;
        var wText = ctx.measureText(text).width;
        var lx = p.x + (o.target ? 20 : 9);
        var ly = p.y - 7;

        ctx.fillStyle = 'rgba(8,9,11,0.7)';
        ctx.fillRect(lx - pad, ly - 9, wText + pad * 2, 15);
        if (isLocked) {
          ctx.strokeStyle = o.color;
          ctx.lineWidth = 1;
          ctx.strokeRect(lx - pad, ly - 9, wText + pad * 2, 15);
        }
        ctx.fillStyle = o.target ? o.color : 'rgba(232,237,242,0.85)';
        ctx.fillText(text, lx, ly + 2);
        continue;
      }

      var dAz = angularDelta(this.view.heading, o.direction.azimuth);
      var dAlt = o.direction.altitude - this.view.elevation;
      offScreen.push({ o: o, away: Math.hypot(dAz, dAlt), dAz: dAz, dAlt: dAlt });
    }

    // Targets first, then the nearest few stars — the app's rule. The control
    // pills live along the bottom, so the usable frame stops short of them.
    var frameH = vp.height - 44;

    var markers = offScreen
      .filter(function (e) { return e.o.target || e.away < 70; })
      .sort(function (a, b) {
        if (a.o.target !== b.o.target) return a.o.target ? -1 : 1;
        return a.away - b.away;
      })
      .slice(0, 5)
      .map(function (item) {
        var e = edgeIndicator(item.dAz, item.dAlt, vp.width, frameH);
        e.o = item.o;
        return e;
      });

    separateEdgeIndicators(markers, vp.width, frameH)
      .forEach(function (e) {
        var o = e.o;

        ctx.save();
        ctx.translate(e.x, e.y);
        ctx.rotate(e.rotation * DEG);
        ctx.strokeStyle = o.color;
        ctx.globalAlpha = o.target ? 0.95 : 0.42;
        ctx.lineWidth = 1.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-3.5, -4.5);
        ctx.lineTo(3, 0);
        ctx.lineTo(-3.5, 4.5);
        ctx.stroke();
        ctx.restore();

        ctx.globalAlpha = o.target ? 0.95 : 0.5;
        ctx.fillStyle = o.color;
        ctx.textAlign = 'center';
        // Keep the caption inside the frame rather than clipped at the border.
        var ly = e.y < frameH / 2 ? e.y + 17 : e.y - 11;
        var lw = ctx.measureText(o.label).width / 2 + 4;
        ctx.fillText(o.label, Math.max(lw, Math.min(vp.width - lw, e.x)), ly);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
      });
  };

  window.SkyView = SkyView;
  window.SkyMath = {
    compassPoint: compassPoint,
    normalizeDegrees: normalizeDegrees,
    satelliteLookAngle: satelliteLookAngle,
  };
})();
