"""Regenerate the gauge font and icon declarations. Requires fonttools."""

import json
from math import ceil, cos, radians, sin
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen


UNITS_PER_EM = 1000
CENTRE = UNITS_PER_EM // 2
OUTER_RADIUS = 375
INNER_RADIUS = 300
# Overlap the ring to avoid gaps between approximated arcs.
FILL_RADIUS = INNER_RADIUS + 10
FIRST_CODEPOINT = 0xE000
PERCENTAGES = range(101)


def point(radius, angle):
    angle = radians(angle)
    return (
        round(CENTRE + radius * cos(angle)),
        round(CENTRE + radius * sin(angle)),
    )


def arc(pen, radius, start, end):
    steps = ceil(abs(end - start) / 45)
    step = (end - start) / steps
    for index in range(steps):
        angle = start + index * step
        control = point(radius / cos(radians(step / 2)), angle + step / 2)
        pen.qCurveTo(control, point(radius, angle + step))


def gauge(percent):
    pen = TTGlyphPen(None)
    pen.moveTo(point(OUTER_RADIUS, 90))
    arc(pen, OUTER_RADIUS, 90, -270)
    pen.closePath()
    if percent < 100:
        # Draw the inner contour in the opposite direction to cut out the centre.
        pen.moveTo(point(INNER_RADIUS, 90))
        arc(pen, INNER_RADIUS, 90, 450)
        pen.closePath()
        if percent:
            pen.moveTo((CENTRE, CENTRE))
            pen.lineTo(point(FILL_RADIUS, 90))
            arc(pen, FILL_RADIUS, 90, 90 - percent * 3.6)
            pen.closePath()
    return pen.glyph()


def build_font(font_path):
    names = [f"gauge{percent}" for percent in PERCENTAGES]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    glyphs.update({name: gauge(percent) for percent, name in enumerate(names)})
    metrics = {name: (UNITS_PER_EM, CENTRE - OUTER_RADIUS) for name in names}
    metrics[".notdef"] = (UNITS_PER_EM, 0)

    font = FontBuilder(UNITS_PER_EM, isTTF=True)
    font.setupGlyphOrder([".notdef", *names])
    font.setupCharacterMap({
        FIRST_CODEPOINT + percent: name for percent, name in enumerate(names)
    })
    font.setupGlyf(glyphs)
    font.setupHorizontalMetrics(metrics)
    font.setupHorizontalHeader(ascent=UNITS_PER_EM, descent=0)
    font.setupNameTable({
        "familyName": "Codex Usage Gauges",
        "styleName": "Regular",
        "uniqueFontIdentifier": "Codex Usage Gauges Regular 1.0",
        "fullName": "Codex Usage Gauges Regular",
        "psName": "CodexUsageGauges-Regular",
        "version": "Version 1.0",
    })
    font.setupOS2(
        sTypoAscender=UNITS_PER_EM, sTypoDescender=0,
        usWinAscent=UNITS_PER_EM, usWinDescent=0,
    )
    font.setupPost()
    font.setupMaxp()
    # Use a fixed timestamp so regeneration produces the same font bytes.
    font.font["head"].created = font.font["head"].modified = 2082844800
    font.font.recalcTimestamp = False
    font.font.flavor = "woff"
    font.save(font_path)


def update_manifest(manifest_path):
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    icons = manifest["contributes"].setdefault("icons", {})
    for percent in PERCENTAGES:
        icons[f"codex-usage-gauge-{percent}"] = {
            "description": f"Codex allowance gauge, {percent}% remaining.",
            "default": {
                "fontPath": "./media/gauges.woff",
                "fontCharacter": f"\\{FIRST_CODEPOINT + percent:04X}",
            },
        }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main():
    root = Path(__file__).resolve().parent.parent
    build_font(root / "media" / "gauges.woff")
    update_manifest(root / "package.json")


if __name__ == "__main__":
    main()
