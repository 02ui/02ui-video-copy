#!/usr/bin/env python3
"""motionlint.py — catch the generic "AI motion" look in a composition BEFORE you render.

A render takes minutes; this takes a second. It reads the HyperFrames project's HTML/JS/CSS and
flags the patterns that motion-feel.md and the Original-mode ban list say make a video look
generated. Every rule names the fix.

Usage: motionlint.py <hf_dir_or_file> [--original] [--json]
  --original   also apply the Original-mode bans (glass, gradient blobs, slide-up-from-below)
Exit code 1 when any ERROR is found, so round.sh can stop before a wasted render.
Deps: none (stdlib only).
"""
from __future__ import annotations
import argparse, json, os, re, sys
from collections import Counter

EXT = (".html", ".htm", ".js", ".mjs", ".css")
SKIP = ("node_modules", "motion.js", ".min.", "gsap", "vendor")

# (level, id, regex, message, original_only)
RULES = [
    ("ERROR", "css-transition", r"(?<![\w-])transition\s*:\s*(?!none)", "CSS transition: not a function of the frame, so renders drift. Drive the value from draw(F).", False),
    ("ERROR", "css-animation", r"(?<![\w-])animation\s*:\s*(?!none)|@keyframes", "CSS animation/@keyframes: runs on wall-clock time, not the frame. Use kf()/spring() in draw(F).", False),
    ("ERROR", "timer", r"\b(setTimeout|setInterval|requestAnimationFrame)\s*\(", "Timer: state carried between frames. Everything must be a pure function of the frame.", False),
    ("ERROR", "clock", r"\b(Date\.now|performance\.now|new Date)\s*\(", "Wall clock: renders will not be repeatable. Use the frame number.", False),
    ("ERROR", "random", r"\bMath\.random\s*\(", "Math.random(): a different video every render. Use M.rnd(i) / M.noise(x, seed).", False),
    ("WARN", "gsap-tween", r"\bgsap\.(to|from|fromTo)\s*\(", "Standalone gsap tween: fine for the master clock only. Position things in draw(F) so fixes stay one line.", False),
    ("WARN", "default-font", r"font-family\s*:\s*[^;\"']*\b(Arial|Helvetica|system-ui|-apple-system|Roboto|Segoe UI|sans-serif\s*[;\"'])", "Default font: the safe-font look. Load the brand's (or the measured match's) font file with @font-face.", False),
    ("ERROR", "glass", r"backdrop-filter\s*:|-webkit-backdrop-filter", "Frosted glass is banned in Original mode (2026-09-29 reviewer note).", True),
    ("ERROR", "gradient-blob", r"radial-gradient\s*\(", "Radial gradient blob is banned in Original mode. Use a measured background (bgfield.py) or a flat ground.", True),
]

EASE_RE = re.compile(r"\b(?:E\.(\w+)|M\.E\.(\w+)|ease\s*:\s*[\"']([\w.()]+)[\"']|cubic-bezier\([^)]*\))")
SLIDE_UP_RE = re.compile(r"translateY\(\s*\$\{[^}]*\(\s*1\s*-|translateY\(\s*\d{2,}\s*px|y\s*:\s*\d{2,}\b")


def files(root):
    if os.path.isfile(root):
        yield root; return
    for d, dirs, fs in os.walk(root):
        dirs[:] = [x for x in dirs if x not in ("node_modules", ".git", "renders")]
        for f in fs:
            p = os.path.join(d, f)
            if f.endswith(EXT) and not any(s in p for s in SKIP):
                yield p


def strip_comments(src):
    src = re.sub(r"/\*.*?\*/", lambda m: "\n" * m.group().count("\n"), src, flags=re.S)
    src = re.sub(r"<!--.*?-->", lambda m: "\n" * m.group().count("\n"), src, flags=re.S)
    return re.sub(r"(?<![:\"'\\])//[^\n]*", "", src)


def lint(root, original):
    hits, eases, slides = [], Counter(), 0
    for p in files(root):
        src = strip_comments(open(p, encoding="utf-8", errors="ignore").read())
        lines = src.split("\n")
        for lvl, rid, rx, msg, orig in RULES:
            if orig and not original:
                continue
            for i, ln in enumerate(lines, 1):
                if re.search(rx, ln):
                    hits.append(dict(level=lvl, rule=rid, file=os.path.relpath(p, root if os.path.isdir(root) else os.path.dirname(p)), line=i, text=ln.strip()[:120], fix=msg))
        for m in EASE_RE.finditer(src):
            eases[next((g for g in m.groups() if g), "cubic-bezier")] += 1
        slides += len(SLIDE_UP_RE.findall(src))
    # whole-project rules
    used = {k: v for k, v in eases.items() if k not in ("lin", "none", "linear")}
    total = sum(used.values())
    if total >= 6:
        top, n = max(used.items(), key=lambda kv: kv[1])
        if n / total > 0.7:
            hits.append(dict(level="WARN", rule="one-ease", file="(project)", line=0, text=f"{top} used {n}/{total} times",
                             fix="One ease on everything reads as generated (motion-feel.md #2). Entrances: out4/expoOut; exits: in3; camera: io3/path(); settles: spring()."))
    if original and slides:
        hits.append(dict(level="ERROR" if slides >= 3 else "WARN", rule="slide-up", file="(project)", line=0, text=f"{slides} translateY-from-below entrance(s) (one in a loop moves many elements)",
                         fix="Cards sliding up from below is the stock AI launch look (Original-mode ban). Use a cut on motion, a mask reveal, a scale from the product's own pixels, or a camera move."))
    return hits, dict(eases=dict(eases), slide_ups=slides)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path"); ap.add_argument("--original", action="store_true"); ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    hits, stats = lint(a.path, a.original)
    if a.json:
        print(json.dumps(dict(hits=hits, stats=stats), indent=1))
    else:
        for h in hits:
            where = f"{h['file']}:{h['line']}" if h["line"] else h["file"]
            print(f"{h['level']:5} {h['rule']:14} {where}\n      {h['text']}\n      fix: {h['fix']}")
        e = sum(h["level"] == "ERROR" for h in hits); w = len(hits) - e
        print(f"\nmotionlint: {e} error(s), {w} warning(s). Eases used: " + (", ".join(f"{k}x{v}" for k, v in sorted(stats['eases'].items(), key=lambda kv: -kv[1])) or "none found"))
    sys.exit(1 if any(h["level"] == "ERROR" for h in hits) else 0)


if __name__ == "__main__":
    main()
