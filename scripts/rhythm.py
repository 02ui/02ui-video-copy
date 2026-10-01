#!/usr/bin/env python3
"""rhythm.py — find the dead moment and the rhythm gap in a render, in numbers.

Original mode has no reference to diff against, and its self-review used to be "watch it and look
for the dead moment". This reads burst.py's analysis.json for your render and reports:

  dead moments     stretches with no motion event longer than --dead seconds (not a deliberate hold)
  metronome cuts   shot lengths too even (coefficient of variation under 0.2)
  one-ease edit    most motion events share one easing shape
  hard-stop moves  ease-out settles shorter than --settle frames (premium settles: 30-33 f @ 30 fps)
  staged cut-ins   moves that ease IN right after a cut (shots should cut in on motion)
  off-beat cuts    when there is music: share of cuts more than 2 frames from an onset
  donor deltas     with --donor: avg shot length, settle length, event density vs real launch videos

Usage: rhythm.py <render_analysis_dir_or_json> [--donor <analysis_dir_or_json> ...]
                 [--dead 1.2] [--settle 0] [-o RHYTHM.md]
Exit code 1 when anything is flagged. Deps: none (stdlib only).
"""
from __future__ import annotations
import argparse, json, os, statistics as st, sys


def load(p):
    return json.load(open(os.path.join(p, "analysis.json") if os.path.isdir(p) else p))


def summary(j):
    fps = j["meta"]["fps"]; shots = j["shots"]
    ev = [e for s in shots for e in s["motion_events"]]
    durs = [s["dur"] for s in shots]
    outs = [e["frames"] for e in ev if e["hint"].startswith("ease-out")]
    return dict(fps=fps, shots=len(shots), avg_shot=st.mean(durs) if durs else 0,
                cv=(st.pstdev(durs) / st.mean(durs)) if len(durs) > 1 and st.mean(durs) else 0,
                settle=st.median(outs) / fps if outs else 0, density=len(ev) / max(1e-6, j["meta"]["dur"]))


def check(j, dead_s, settle_f):
    fps = j["meta"]["fps"]; shots = j["shots"]; out = []
    settle_f = settle_f or round(0.9 * fps)  # ~27 f at 30 fps, under the measured 30-33 f
    # dead moments: gaps between motion events (and shot edges) inside each shot
    for s in shots:
        marks = [s["start_f"]] + [x for e in s["motion_events"] for x in (e["start_f"], e["end_f"])] + [s["end_f"]]
        for a, b in zip(marks[0::2], marks[1::2]):
            if (b - a) / fps > dead_s:
                out.append(("dead", f"shot {s['shot']}: f{a}-f{b} ({(b - a) / fps:.2f}s) nothing moves",
                            "Give it life (M.wobble / M.drift / a camera push), or cut earlier. A deliberate read-hold is fine: say so in BREAKDOWN.md."))
    # metronome cuts
    durs = [s["dur"] for s in shots]
    if len(durs) >= 4:
        cv = st.pstdev(durs) / st.mean(durs)
        if cv < 0.2:
            out.append(("metronome", f"{len(durs)} shots, length CV {cv:.2f} (avg {st.mean(durs):.2f}s)",
                        "Every shot the same length reads as a template. Vary it: short punches around one long hero hold."))
    # one-ease edit
    ev = [e for s in shots for e in s["motion_events"]]
    if len(ev) >= 5:
        shapes = [e["hint"].split(" (")[0].split(" +")[0] for e in ev]
        top = max(set(shapes), key=shapes.count)
        if shapes.count(top) / len(shapes) > 0.8:
            out.append(("one-ease", f"{shapes.count(top)}/{len(shapes)} moves are '{top}'",
                        "Vary easing by role: entrances out4/expoOut, exits in3, camera io3/path(), settles spring()."))
    for s in shots:
        for e in s["motion_events"]:
            if e["hint"].startswith("ease-out") and e["frames"] < settle_f:
                out.append(("hard-stop", f"shot {s['shot']}: f{e['start_f']}-f{e['end_f']} settles in {e['frames']} f",
                            f"Too fast to feel premium (motion-feel.md #3). Stretch the tail to >= {settle_f} f, or use a spring with springFrames()."))
            if s["shot"] > 1 and e["start_f"] - s["start_f"] <= 2 and e["hint"].startswith("ease-in ("):
                out.append(("staged-cut", f"shot {s['shot']}: move eases in from the cut at f{e['start_f']}",
                            "Cut in ON motion (motion-feel.md #6). Start at speed: M.cutIn() or E.expoOut."))
    # beat
    ons = (j.get("audio") or {}).get("onsets") or []
    if ons and len(shots) > 2:
        cuts = [s["start"] for s in shots[1:]]
        off = [c for c in cuts if min(abs(o - c) for o in ons) > 2 / fps]
        if len(off) / len(cuts) > 0.5:
            out.append(("off-beat", f"{len(off)}/{len(cuts)} cuts sit more than 2 f from a music onset",
                        "Move cuts onto the beat grid in BREAKDOWN.md (bpm in ANALYSIS.md)."))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("render"); ap.add_argument("--donor", action="append", default=[])
    ap.add_argument("--dead", type=float, default=1.2); ap.add_argument("--settle", type=int, default=0)
    ap.add_argument("-o", "--out")
    a = ap.parse_args()
    j = load(a.render); flags = check(j, a.dead, a.settle); me = summary(j)
    L = ["# Rhythm check", "",
         f"{me['shots']} shots, avg {me['avg_shot']:.2f}s, length CV {me['cv']:.2f}, median settle {me['settle']:.2f}s, {me['density']:.2f} moves/s", ""]
    if a.donor:
        L += ["## Against donors", "", "| | yours | donors (mean) |", "|---|---|---|"]
        ds = [summary(load(d)) for d in a.donor]
        for k, lab in [("avg_shot", "avg shot (s)"), ("cv", "shot length CV"), ("settle", "median settle (s)"), ("density", "moves per second")]:
            dm = st.mean(d[k] for d in ds)
            warn = "  ⚠" if dm and abs(me[k] - dm) / dm > 0.35 else ""
            L.append(f"| {lab} | {me[k]:.2f} | {dm:.2f}{warn} |")
        L.append("")
    L += [f"## {len(flags)} flag(s)", ""]
    for kind, what, fix in flags:
        L += [f"- **{kind}**: {what}", f"  fix: {fix}"]
    if not flags:
        L.append("- none. Now watch it at full speed: the numbers find the gap, the eye judges it.")
    txt = "\n".join(L) + "\n"
    print(txt)
    if a.out:
        open(a.out, "w").write(txt)
    sys.exit(1 if flags else 0)


if __name__ == "__main__":
    main()
