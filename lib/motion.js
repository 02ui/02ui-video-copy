// motion.js — frame-pure motion helpers for HyperFrames compositions (02ui-video-copy)
//
// Every function returns a value from the frame number alone: no timers, no state between frames.
// That keeps renders deterministic and makes every fix a one-line change. Each helper exists
// because of a measured mistake in references/motion-feel.md (numbers in the comments).
//
// Use in a composition:  <script src="motion.js"></script>   then   const { E, kf, spring, ... } = M;
// Copy the file into hf/ (HyperFrames lint wants local files).
(function (root) {
  const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
  const remap = (v, a, b, c, d, ease = (t) => t) => lerp(c, d, ease(clamp(invLerp(a, b, v))));

  // ------------------------------------------------------------------ easings (t in [0,1])
  // Vary them. One ease on everything is the first sign of AI motion (motion-feel.md, mistake 2).
  const E = {
    lin: (t) => t,
    out2: (t) => 1 - (1 - t) ** 2,
    out3: (t) => 1 - (1 - t) ** 3,
    out4: (t) => 1 - (1 - t) ** 4,   // premium UI settle (Raycast cascade: quartic, 30-33 f)
    out5: (t) => 1 - (1 - t) ** 5,
    expoOut: (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t)),
    circOut: (t) => Math.sqrt(1 - (t - 1) ** 2),
    in2: (t) => t * t,
    in3: (t) => t * t * t,
    expoIn: (t) => (t <= 0 ? 0 : 2 ** (10 * t - 10)),
    io3: (t) => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2),
    sine: (t) => 0.5 - 0.5 * Math.cos(Math.PI * t),
    backOut: (t, s = 1.4) => 1 + (s + 1) * (t - 1) ** 3 + s * (t - 1) ** 2,
  };

  // cubic-bezier(x1,y1,x2,y2) exactly as CSS / After Effects / Figma define it.
  // Paste a designer's curve straight in: E.bez(0.16, 1, 0.3, 1)
  E.bez = function (x1, y1, x2, y2) {
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const X = (u) => ((ax * u + bx) * u + cx) * u, Y = (u) => ((ay * u + by) * u + cy) * u;
    const dX = (u) => (3 * ax * u + 2 * bx) * u + cx;
    return (t) => {
      if (t <= 0) return 0; if (t >= 1) return 1;
      let u = t;
      for (let i = 0; i < 8; i++) { const d = dX(u), x = X(u) - t; if (Math.abs(x) < 1e-7) return Y(u); if (Math.abs(d) < 1e-6) break; u -= x / d; }
      let a = 0, b = 1; u = t;                                    // bisection fallback
      for (let i = 0; i < 40; i++) { const x = X(u); if (Math.abs(x - t) < 1e-7) break; if (x < t) a = u; else b = u; u = (a + b) / 2; }
      return Y(u);
    };
  };

  const prog = (F, a, b, ease = E.lin) => ease(clamp(invLerp(a, b, F)));

  // ------------------------------------------------------------------ keyframes
  // kf(F, [[f, v, ease?], ...]) — ease on a key applies to the segment arriving at it.
  // Warning: easing every key in AND out stops the object at each key (mistake 1).
  // For a move through several keys, use E.out* on the last key only, or path().
  function kf(F, keys, ease = E.io3) {
    if (F <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) if (F <= keys[i][0]) {
      const [f0, v0] = keys[i - 1], [f1, v1, e] = keys[i];
      return lerp(v0, v1, (e || ease)((F - f0) / (f1 - f0)));
    }
    return keys[keys.length - 1][1];
  }

  // path(F, [[f, v], ...], ease) — ONE ease over the whole move, Catmull-Rom through the keys.
  // The object never stops at a middle key: speed only reaches zero at the ends.
  function path(F, keys, ease = E.io3) {
    const a = keys[0][0], b = keys[keys.length - 1][0];
    if (F <= a) return keys[0][1]; if (F >= b) return keys[keys.length - 1][1];
    const g = a + (b - a) * ease((F - a) / (b - a));              // eased frame along the whole move
    let i = 1; while (i < keys.length - 1 && g > keys[i][0]) i++;
    const P = (k) => keys[clamp(k, 0, keys.length - 1)][1];
    const p0 = P(i - 2), p1 = P(i - 1), p2 = P(i), p3 = P(i + 1);
    const t = (g - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]), t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }

  // ------------------------------------------------------------------ springs (closed form, physical units)
  // spring(tSec, {stiffness, damping, mass, velocity}) -> 0..1 (overshoots when underdamped).
  // Same parameters as Framer Motion / React Spring / SwiftUI, so a designer's spring ports 1:1.
  function spring(t, o = {}) {
    const k = o.stiffness ?? 170, c = o.damping ?? 26, m = o.mass ?? 1, v0 = -(o.velocity ?? 0);
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k / m), z = c / (2 * Math.sqrt(k * m)), x0 = 1;   // x = distance left to travel
    let x;
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      x = Math.exp(-z * w0 * t) * (x0 * Math.cos(wd * t) + ((v0 + z * w0 * x0) / wd) * Math.sin(wd * t));
    } else if (z === 1) {
      x = Math.exp(-w0 * t) * (x0 + (v0 + w0 * x0) * t);
    } else {
      const s = w0 * Math.sqrt(z * z - 1), r1 = -z * w0 + s, r2 = -z * w0 - s;
      const B = (v0 - r1 * x0) / (r2 - r1), A = x0 - B;
      x = A * Math.exp(r1 * t) + B * Math.exp(r2 * t);
    }
    return 1 - x;
  }
  // frames for a spring to stay within `tol` of 1 — size the shot window from this, never guess
  function springFrames(fps, o = {}, tol = 0.005) {
    let last = 0;
    for (let f = 1; f < fps * 10; f++) if (Math.abs(1 - spring(f / fps, o)) > tol) last = f;
    return last + 1;
  }
  // a value that retargets: one spring per change, summed (SKILL.md §4)
  // springTo(F, fps, [[f0, v0], [f1, v1], ...], opts)
  function springTo(F, fps, keys, o) {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (F < keys[i][0]) break;
      v += (keys[i][1] - keys[i - 1][1]) * spring((F - keys[i][0]) / fps, keys[i][2] || o);
    }
    return v;
  }

  // ------------------------------------------------------------------ shaped moves from measured references
  // big scale changes in log space: 8x -> 1x linear lurches at the end (mistake 4)
  const logScale = (t, s0, s1, ease = E.out4) => s0 * (s1 / s0) ** ease(clamp(t));
  // floating product / drifting camera: quick ease-out plus steady drift, never a dead stop
  // (MarkKnd: p(t) = A(1 - e^(-t/tau)) + B*t, tau 6 f hero, 8.5-17 f stacked parts; corr 0.73 -> 0.98)
  const drift = (f, A, tau, B = 0) => (f <= 0 ? 0 : A * (1 - Math.exp(-f / tau)) + B * f);
  // a shot that cuts in ON motion: starts at speed, settles (mistake 6: no ease-in at a cut)
  const cutIn = (F, a, b, from, to, ease = E.expoOut) => lerp(from, to, prog(F, a, b, ease));

  // ------------------------------------------------------------------ groups
  // stagger: item i starts `step` frames after i-1, plus seeded jitter so rows never land in lockstep
  // (Raycast rows: 2-2.5 f apart; 1 f off cost -0.02 motion corr)
  function stagger(F, i, start, step, dur, ease = E.out4, jitter = 0, seed = 1) {
    const s = start + i * step + (jitter ? (rnd(i * 7.13 + seed) - 0.5) * 2 * jitter : 0);
    return prog(F, s, s + dur, ease);
  }
  // container first, content ~1 f later, chrome last (Raycast cascade)
  const layered = (F, start, dur, ease = E.out4, lags = [0, 1, 3]) => lags.map((l) => prog(F, start + l, start + l + dur, ease));

  // ------------------------------------------------------------------ seeded randomness and life
  function rnd(i) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); }
  // smooth 1D value noise, -1..1. Use for drift, hand-held camera, flicker. Never Math.random().
  function noise(x, seed = 0) {
    const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
    return lerp(rnd(i + seed * 1013) * 2 - 1, rnd(i + 1 + seed * 1013) * 2 - 1, u);
  }
  // fractal noise: 3 octaves, for a hand-held or breathing feel
  const fbm = (x, seed = 0) => (noise(x, seed) * 0.57 + noise(x * 2.03, seed + 1) * 0.29 + noise(x * 4.1, seed + 2) * 0.14);
  // idle float: sum of slow, unrelated sines, so a still object is never frozen
  const wobble = (F, amp, period = 90, seed = 0) =>
    amp * (0.6 * Math.sin((2 * Math.PI * F) / period + seed) + 0.4 * Math.sin((2 * Math.PI * F) / (period * 1.618) + seed * 2.3));

  // ------------------------------------------------------------------ cadence and blur
  // animate on 2s (or 3s): hold each pose N frames (mistake 10)
  const onTwos = (F, n = 2) => Math.floor(F / n) * n;
  // blur ramps start at ~0.3 px, never 0 -> 1 px in one frame (mistake 9)
  const blurRamp = (t, max, min = 0.3) => (t <= 0 ? 0 : min + (max - min) * clamp(t));

  const M = { clamp, lerp, invLerp, remap, E, prog, kf, path, spring, springFrames, springTo,
    logScale, drift, cutIn, stagger, layered, rnd, noise, fbm, wobble, onTwos, blurRamp };
  if (typeof module !== "undefined" && module.exports) module.exports = M; else root.M = M;
})(typeof window !== "undefined" ? window : globalThis);
