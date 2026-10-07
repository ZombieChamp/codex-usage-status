"""Regenerate the gauge and ChatGPT icon font. Requires fonttools."""

import json
import re
from math import ceil, cos, isfinite, radians, sin
from pathlib import Path
from xml.etree import ElementTree

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.cu2quPen import Cu2QuPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.svgLib.path import parse_path


UNITS_PER_EM = 1000
CENTRE = UNITS_PER_EM // 2
OUTER_RADIUS = 375
INNER_RADIUS = 300
# Overlap the ring to avoid gaps between approximated arcs.
FILL_RADIUS = INNER_RADIUS + 10
FIRST_CODEPOINT = 0xE000
PERCENTAGES = range(101)
LOGO_CODEPOINT = FIRST_CODEPOINT + len(PERCENTAGES)


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


def parse_viewbox(value):
    number = r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?"
    separator = r"(?:\s*,\s*|\s+)"
    match = re.fullmatch(
        rf"\s*({number}){separator}({number})"
        rf"{separator}({number}){separator}({number})\s*",
        value,
        flags=re.ASCII,
    )
    message = (
        "Logo SVG viewBox must contain four finite numbers "
        "with positive width and height."
    )
    if not match:
        raise ValueError(message)
    left, top, width, height = map(float, match.groups())
    if (
        not all(isfinite(value) for value in (left, top, width, height))
        or width <= 0
        or height <= 0
    ):
        raise ValueError(message)
    return left, top, width, height


def chatgpt_logo(svg_path):
    root = ElementTree.parse(svg_path).getroot()
    namespace = "{http://www.w3.org/2000/svg}"
    if (
        root.tag != f"{namespace}svg"
        or set(root.attrib) - {"viewBox", "width", "height", "fill"}
    ):
        raise ValueError(
            "Logo SVG root must use the SVG namespace and only "
            "viewBox, width, height and fill attributes."
        )
    allowed_attributes = {
        f"{namespace}title": set(),
        f"{namespace}path": {"d", "fill"},
    }
    for element in root:
        attributes = allowed_attributes.get(element.tag)
        if (
            attributes is None
            or set(element.attrib) - attributes
            or len(element)
        ):
            raise ValueError(
                "Logo SVG must use flat paths without transforms or CSS styling."
            )
    paths = root.findall(f"{namespace}path")
    if len(paths) != 1:
        raise ValueError(
            "Logo SVG must contain exactly one filled path. "
            "Combine shapes into a single compound path."
        )
    path = paths[0]
    fill = path.get("fill", root.get("fill", "black")).strip()
    if fill == "none" or fill.startswith("url("):
        raise ValueError("Logo SVG path must have a solid fill.")
    left, top, width, height = parse_viewbox(root.get("viewBox", ""))
    scale = OUTER_RADIUS * 2 / max(width, height)
    pen = TTGlyphPen(None)
    transformed = TransformPen(Cu2QuPen(pen, max_err=1), (
        scale, 0, 0, -scale,
        CENTRE - scale * (left + width / 2),
        CENTRE + scale * (top + height / 2),
    ))
    parse_path(path.get("d", ""), transformed)
    glyph = pen.glyph()
    if glyph.numberOfContours == 0:
        raise ValueError("Logo SVG path must contain a filled outline.")
    return glyph


def build_font(font_path, logo_path):
    names = [f"gauge{percent}" for percent in PERCENTAGES]
    glyphs = {".notdef": TTGlyphPen(None).glyph()}
    glyphs.update({name: gauge(percent) for percent, name in enumerate(names)})
    glyphs["chatgpt"] = chatgpt_logo(logo_path)
    names.append("chatgpt")
    metrics = {name: (UNITS_PER_EM, CENTRE - OUTER_RADIUS) for name in names}
    metrics[".notdef"] = (UNITS_PER_EM, 0)

    font = FontBuilder(UNITS_PER_EM, isTTF=True)
    font.setupGlyphOrder([".notdef", *names])
    characters = {
        FIRST_CODEPOINT + percent: name for percent, name in enumerate(names)
    }
    font.setupCharacterMap(characters)
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
    icons["codex-usage-chatgpt"] = {
        "description": "ChatGPT logo before each Codex allowance gauge.",
        "default": {
            "fontPath": "./media/gauges.woff",
            "fontCharacter": f"\\{LOGO_CODEPOINT:04X}",
        },
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")


def main():
    root = Path(__file__).resolve().parent.parent
    build_font(root / "media" / "gauges.woff", root / "media" / "chatgpt.svg")
    update_manifest(root / "package.json")


if __name__ == "__main__":
    main()
