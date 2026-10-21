#!/usr/bin/env python3
"""Build the single-file Track Analyzer for static hosts (tiiny / GitHub Pages).

Inlines css/app.css + all js/*.js into index.html -> track-analyzer-single.html.
version.json + changelog.json are NOT inlined: they must be uploaded alongside
the single file for "Check for updates" to work (the app degrades gracefully
without them — What's New falls back to embedded history).

Usage: python3 build-single.py   (run from this folder)
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def inline_css(html: str) -> str:
    css = (ROOT / "css" / "app.css").read_text(encoding="utf-8")
    assert "</style" not in css, "CSS contains a closing style tag"
    # v2.9.0: asset URLs carry a ?v= cache-buster since v2.3.1 — allow it.
    pattern = re.compile(r'<link rel="stylesheet" href="css/app\.css(\?v=[0-9.]+)?" ?/?>')
    assert pattern.search(html), "CSS link tag not found in index.html"
    return pattern.sub(lambda m: "<style>\n" + css + "\n</style>", html, count=1)

def inline_js(html: str) -> str:
    # v2.9.0: full script list in index.html order (nutrition.js and
    # cam-mode.js were missing — the single file silently shipped
    # without the Nutrition tab and the mode picker), ?v= allowed.
    for name in ["mediapipe-pose.js", "mediapipe-draw.js", "camera-kit.js", "rig.js", "app.js", "dualcam.js", "update.js", "ai-knowledge.js", "ai-analyzer.js", "nutrition.js", "cam-mode.js"]:
        js = (ROOT / "js" / name).read_text(encoding="utf-8")
        assert "</script" not in js, f"{name} contains a closing script tag"
        pattern = re.compile(r'<script src="js/' + re.escape(name) + r'(\?v=[0-9.]+)?"></script>')
        assert pattern.search(html), f"script tag for {name} not found in index.html"
        html = pattern.sub(lambda m, js=js: "<script>\n" + js + "\n</script>", html, count=1)
    return html

def main() -> None:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = inline_css(html)
    html = inline_js(html)
    assert "css/app.css" not in html and 'src="js/' not in html, "inlining incomplete"
    out = ROOT / "track-analyzer-single.html"
    out.write_text(html, encoding="utf-8")
    print(f"Wrote {out} ({out.stat().st_size / 1024:.0f} KB)")

if __name__ == "__main__":
    main()
