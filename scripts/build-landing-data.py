#!/usr/bin/env python3
"""
Regenerates docs/sky-data.js from src/lib/sky/catalogue.ts.

The landing page runs the same star field as the app. Hand-copying the catalogue
into the page would work exactly once and then drift silently — a star added to
the app would never appear on the site, and nothing would fail. So the page's
data is generated from the app's source instead.

  python3 scripts/build-landing-data.py

Deliberately strict: any change to the shape of the TypeScript literals raises
here rather than emitting a half-parsed catalogue.
"""

from __future__ import annotations

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SOURCE = os.path.join(ROOT, "src", "lib", "sky", "catalogue.ts")
TARGET = os.path.join(ROOT, "docs", "sky-data.js")


def extract_literal(text: str, declaration: str) -> str:
    """Returns the array literal that follows `declaration`, brackets balanced."""
    start = text.find(declaration)
    if start == -1:
        raise SystemExit(f"could not find `{declaration}` in {SOURCE}")

    # After the `=`, not after the declaration: `Star[]` in the type annotation
    # has a bracket of its own and matching it yields an empty catalogue.
    open_at = text.index("[", text.index("=", start))
    depth = 0
    for i in range(open_at, len(text)):
        if text[i] == "[":
            depth += 1
        elif text[i] == "]":
            depth -= 1
            if depth == 0:
                return text[open_at : i + 1]
    raise SystemExit(f"unbalanced brackets after `{declaration}`")


def to_json(literal: str) -> object:
    """TypeScript object literals to JSON. Narrow on purpose — see the docstring."""
    # Comments first, or a quote inside one would confuse the string handling.
    literal = re.sub(r"/\*.*?\*/", "", literal, flags=re.S)
    literal = re.sub(r"//[^\n]*", "", literal)
    # Single-quoted strings to double-quoted. No escaped quotes occur in the
    # catalogue, and a star named O'Brien would fail loudly here rather than
    # quietly producing broken JSON.
    if "\\'" in literal:
        raise SystemExit("escaped quote in the catalogue; extend this converter")
    literal = re.sub(r"'([^']*)'", r'"\1"', literal)
    # Bare keys to quoted keys.
    literal = re.sub(r"([{,]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:", r'\1"\2":', literal)
    # Trailing commas.
    literal = re.sub(r",(\s*[}\]])", r"\1", literal)

    try:
        return json.loads(literal)
    except json.JSONDecodeError as error:
        raise SystemExit(f"catalogue did not convert cleanly: {error}")


HEADER = """/**
 * Star catalogue and constellation figures for the landing page's live sky.
 *
 * Generated from src/lib/sky/catalogue.ts by scripts/build-landing-data.py —
 * do not hand-edit. The page runs the app's real data through a port of the
 * app's real astronomy, so what you see in the browser is what the phone
 * computes, not a decorative approximation.
 *
 * %d stars / %d constellation figures.
 */
"""


def main() -> None:
    text = open(SOURCE).read()

    stars = to_json(extract_literal(text, "export const STARS"))
    figures = to_json(extract_literal(text, "export const CONSTELLATIONS"))

    if not isinstance(stars, list) or len(stars) < 20:
        raise SystemExit(f"expected a list of stars, got {type(stars)} of {len(stars)}")

    names = {s["name"] for s in stars}
    for figure in figures:
        for a, b in figure["lines"]:
            missing = {a, b} - names
            if missing:
                raise SystemExit(f"{figure['name']} references unknown star(s): {missing}")

    with open(TARGET, "w") as f:
        f.write(HEADER % (len(stars), len(figures)))
        f.write("window.SKY_DATA = ")
        f.write(json.dumps({"stars": stars, "figures": figures}, separators=(",", ":")))
        f.write(";\n")

    print(f"wrote {os.path.relpath(TARGET, ROOT)}: {len(stars)} stars, {len(figures)} figures")


if __name__ == "__main__":
    sys.exit(main())
