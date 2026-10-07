"""Check icon generation with FontTools. Run with npm run check:icons."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from fontTools.pens.pointInsidePen import PointInsidePen

from scripts.generate_gauges import build_font, chatgpt_logo, update_manifest


ROOT = Path(__file__).resolve().parent.parent


def logo_glyph(svg):
    with TemporaryDirectory() as directory:
        path = Path(directory) / "logo.svg"
        path.write_text(svg, encoding="utf-8")
        return chatgpt_logo(path)


class IconTests(unittest.TestCase):
    def test_generated_assets_match_committed_files(self):
        with TemporaryDirectory() as directory:
            directory = Path(directory)
            font = directory / "gauges.woff"
            manifest = directory / "package.json"
            build_font(font, ROOT / "media" / "chatgpt.svg")
            manifest.write_bytes((ROOT / "package.json").read_bytes())
            update_manifest(manifest)

            for generated, committed in [
                (font, ROOT / "media" / "gauges.woff"),
                (manifest, ROOT / "package.json"),
            ]:
                with self.subTest(asset=str(committed.relative_to(ROOT))):
                    self.assertTrue(
                        generated.read_bytes() == committed.read_bytes(),
                        f"{committed.relative_to(ROOT)} differs from generated output. "
                        "Run python scripts/generate_gauges.py.",
                    )

    def test_unsupported_svg_input_is_rejected(self):
        path = '<path d="M0 0L24 0L0 24Z"/>'
        cases = {
            "root transform": ('transform="translate(1 0)"', path),
            "path transform": (
                "", path.replace("<path", '<path transform="matrix(1 0 0 1 1 0)"')
            ),
            "group": ("", f"<g>{path}</g>"),
            "nested SVG": ("", f'{path}<svg viewBox="0 0 24 24"/>'),
            "nested path": ("", f'<path d="M0 0L24 0L0 24Z">{path}</path>'),
            "root styling": ('style="opacity: 0"', path),
            "path styling": ("", path.replace("<path", '<path style="opacity: 0"')),
            "stroke": ("", path.replace("<path", '<path stroke="black"')),
            "shape": ("", '<circle cx="12" cy="12" r="10"/>'),
            "inherited empty fill": ('fill="none"', path),
            "empty fill": ("", path.replace("<path", '<path fill="none"')),
            "paint server": ("", path.replace("<path", '<path fill="url(#paint)"')),
            "no paths": ("", "<title>Empty logo</title>"),
            "empty outline": ("", '<path d=""/>'),
        }
        for name, (attributes, contents) in cases.items():
            with self.subTest(input=name):
                with self.assertRaisesRegex(ValueError, "Logo SVG"):
                    logo_glyph(
                        '<svg xmlns="http://www.w3.org/2000/svg" '
                        f'viewBox="0 0 24 24" {attributes}>{contents}</svg>'
                    )

    def test_multiple_filled_paths_are_rejected(self):
        rectangle = '<path d="M0 0H24V24H0Z"/>'
        for second in [rectangle, '<path d="M0 0V24H24V0Z"/>']:
            with self.subTest(second_path=second):
                with self.assertRaisesRegex(ValueError, "exactly one filled path"):
                    logo_glyph(
                        '<svg xmlns="http://www.w3.org/2000/svg" '
                        f'viewBox="0 0 24 24">{rectangle}{second}</svg>'
                    )

    def test_compound_path_preserves_filled_regions_and_holes(self):
        glyph = logo_glyph(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">'
            '<title>Logo with a hole</title>'
            '<path fill="black" d="M0 0H24V24H0Z M6 6V18H18V6Z"/>'
            '</svg>'
        )
        for point, filled in [((200, 200), True), ((500, 500), False)]:
            with self.subTest(point=point):
                pen = PointInsidePen(None, point, evenOdd=False)
                glyph.draw(pen, None)
                self.assertEqual(pen.getResult(), filled)

    def test_viewbox_separators_and_number_formats_preserve_the_outline(self):
        for viewbox in [
            "0 0 24 24",
            "0,0,24,24",
            " 0 , 0, 24 ,24 ",
            "0&#x9;0&#xA;24&#xD;24",
            "+0e0, .0, 2.4e1, 24.",
        ]:
            with self.subTest(viewbox=viewbox):
                glyph = logo_glyph(
                    '<svg xmlns="http://www.w3.org/2000/svg" '
                    f'viewBox="{viewbox}"><path d="M0 0H24V24H0Z"/></svg>'
                )
                self.assertEqual(
                    list(glyph.coordinates),
                    [(125, 875), (875, 875), (875, 125), (125, 125)],
                )

    def test_viewbox_centres_the_outline_and_preserves_its_aspect_ratio(self):
        glyph = logo_glyph(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-15,-10,30,20">'
            '<path d="M-15 -10H15V10H-15Z"/></svg>'
        )
        self.assertEqual(
            list(glyph.coordinates),
            [(125, 750), (875, 750), (875, 250), (125, 250)],
        )

    def test_invalid_viewbox_is_rejected(self):
        for viewbox in [
            None, "", "0 0 24", "0 0 24 24 24", "0 0 wide 24",
            "0,,0,24,24", "0 0 2_4 24", "0,0,24,24,",
            "0&#xA0;0 24 24",
            "0 0 -24 24", "0 0 24 -24", "0 0 -24 -24",
            "0 0 0 24", "0 0 24 0", "0 0 0 0",
            "NaN 0 24 24", "0 inf 24 24", "0 0 -inf 24", "0 0 24 NaN",
            "0 0 1e999 24", "0 0 24 1e-999",
        ]:
            with self.subTest(viewbox=viewbox):
                attributes = "" if viewbox is None else f'viewBox="{viewbox}"'
                with self.assertRaisesRegex(ValueError, "Logo SVG viewBox"):
                    logo_glyph(
                        '<svg xmlns="http://www.w3.org/2000/svg" '
                        f'{attributes}><path d="M0 0H24V24H0Z"/></svg>'
                    )


if __name__ == "__main__":
    unittest.main()
