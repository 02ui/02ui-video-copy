// node lib/motion.test.js — checks the helpers return what the comments promise
const assert = require("node:assert/strict");
const M = require("./motion.js");
const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// easings hit their ends
for (const [k, f] of Object.entries(M.E)) if (k !== "bez") { near(f(0), 0); near(f(1), 1); }

// cubic-bezier matches CSS "ease" (0.25, 0.1, 0.25, 1) at known points
const ease = M.E.bez(0.25, 0.1, 0.25, 1);
near(ease(0.5), 0.8024, 2e-3);
near(ease(0.25), 0.4094, 2e-3);
near(M.E.bez(0, 0, 1, 1)(0.37), 0.37);

// keyframes and path
near(M.kf(5, [[0, 0], [10, 100, M.E.lin]]), 50);
near(M.kf(-1, [[0, 3], [10, 9]]), 3);
near(M.path(0, [[0, 0], [10, 50], [20, 100]]), 0);
near(M.path(20, [[0, 0], [10, 50], [20, 100]]), 100);
// path keeps moving through the middle key: speed at the middle key is not zero
const sp = M.path(10.5, [[0, 0], [10, 50], [20, 100]]) - M.path(9.5, [[0, 0], [10, 50], [20, 100]]);
assert.ok(sp > 1, `path stalls at middle key (speed ${sp})`);

// springs: rest at 1, overshoot when underdamped, none when overdamped
near(M.spring(0), 0);
near(M.spring(5, { stiffness: 170, damping: 26 }), 1);
const peak = (o) => Math.max(...Array.from({ length: 120 }, (_, i) => M.spring(i / 60, o)));
assert.ok(peak({ stiffness: 300, damping: 10 }) > 1.2, "underdamped spring must overshoot");
assert.ok(peak({ stiffness: 100, damping: 40 }) <= 1.0001, "overdamped spring must not overshoot");
near(M.spring(3, { stiffness: 100, damping: 20 }), 1);       // critical
const nf = M.springFrames(30, { stiffness: 170, damping: 26 });
assert.ok(nf > 10 && nf < 40, `springFrames ${nf}`);
near(M.springTo(300, 30, [[0, 0], [10, 50], [40, 20]]), 20);

// shaped moves
near(M.logScale(0, 8, 1), 8); near(M.logScale(1, 8, 1), 1);
near(M.drift(0, 10, 6), 0);
assert.ok(M.cutIn(1, 0, 20, 0, 100) > 20, "cutIn must start at speed");

// groups and noise are deterministic
assert.equal(M.rnd(3), M.rnd(3));
assert.equal(M.noise(2.4, 1), M.noise(2.4, 1));
for (let x = 0; x < 50; x += 0.37) assert.ok(Math.abs(M.fbm(x)) <= 1);
assert.ok(M.stagger(10, 2, 0, 2, 20) < M.stagger(10, 0, 0, 2, 20));
assert.equal(M.onTwos(7), 6);
near(M.blurRamp(0.01, 4), 0.3, 0.05);
console.log("motion.js: all checks pass");
