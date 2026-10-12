"""Build a VSIX using the Python standard library."""

import argparse
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from xml.sax.saxutils import escape, quoteattr

root = Path(__file__).resolve().parent.parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--out-dir", type=Path, default=root / "dist")
parser.add_argument("--vscode-engine", help="Override engines.vscode in the generated VSIX only.")
args = parser.parse_args()
package_contents = (root / "package.json").read_text()
package = json.loads(package_contents)
if args.vscode_engine is not None:
    package["engines"]["vscode"] = args.vscode_engine
    package_contents = json.dumps(package, indent=2) + "\n"
out = args.out_dir
out.mkdir(parents=True, exist_ok=True)
target = out / f'{package["name"]}-{package["version"]}.vsix'

manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-GB" Id="{package['name']}" Version="{package['version']}" Publisher="{package['publisher']}"/>
    <DisplayName>{escape(package['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(package['description'])}</Description>
    <Icon>extension/{escape(package['icon'])}</Icon>
    <Tags>codex,usage,statusbar</Tags>
    <Categories>Other</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value={quoteattr(package['engines']['vscode'])}/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="ui"/>
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Services.Icons.Default" Path="extension/{escape(package['icon'])}" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true"/>
    <Asset Type="Microsoft.VisualStudio.Services.Content.License" Path="extension/LICENCE" Addressable="true"/>
  </Assets>
</PackageManifest>'''

types = '''<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json"/>
  <Default Extension="js" ContentType="application/javascript"/>
  <Default Extension="md" ContentType="text/markdown"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="woff" ContentType="font/woff"/>
  <Default Extension="vsixmanifest" ContentType="text/xml"/>
  <Override PartName="/extension/LICENCE" ContentType="text/plain"/>
</Types>'''

with ZipFile(target, "w", ZIP_DEFLATED) as archive:
    archive.writestr("extension.vsixmanifest", manifest)
    archive.writestr("[Content_Types].xml", types)
    archive.writestr("extension/package.json", package_contents)
    for name in [
        "README.md",
        "LICENCE",
        package["icon"],
        "media/screenshot.png",
        "media/gauges.woff",
        "src/client.js",
        "src/credits.js",
        "src/usage.js",
        "src/time.js",
        "src/extension.js",
    ]:
        archive.write(root / name, "extension/" + name)

print(target)
