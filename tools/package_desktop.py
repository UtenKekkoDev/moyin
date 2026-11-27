"""Add the Windows desktop host to an existing Moyin Windows x64 ZIP."""
from argparse import ArgumentParser
from hashlib import file_digest
from os import environ
from pathlib import Path
from shutil import copyfileobj
import struct
from subprocess import run
from tempfile import TemporaryDirectory
from zipfile import ZIP_DEFLATED, ZipFile


SDK_SHA256 = "ef128016dd1e51c59178c827ed5b8aa3322c57afa8675d930f8109505542ad74"
CORE = "Microsoft.Web.WebView2.Core.dll"
FORMS = "Microsoft.Web.WebView2.WinForms.dll"


def digest(path):
    with path.open("rb") as stream:
        return file_digest(stream, "sha256").hexdigest()


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("base_zip", type=Path)
    parser.add_argument("webview2_sdk", type=Path, help="Microsoft.Web.WebView2 1.0.2903.40 NuGet package")
    args = parser.parse_args()
    if digest(args.webview2_sdk) != SDK_SHA256:
        parser.error("WebView2 SDK checksum mismatch")
    base = args.base_zip.resolve(strict=True)
    root = Path(__file__).resolve().parents[1]
    dest = root / "dist" / (base.stem + "-desktop.zip")
    dest.parent.mkdir(exist_ok=True)
    compiler = Path(environ["WINDIR"]) / "Microsoft.NET/Framework64/v4.0.30319/csc.exe"
    with TemporaryDirectory(dir=dest.parent) as work:
        work = Path(work)
        with ZipFile(args.webview2_sdk) as sdk:
            for member in ["lib/net462/" + CORE, "lib/net462/" + FORMS, "build/native/x64/WebView2Loader.dll", "LICENSE.txt", "NOTICE.txt"]:
                (work / Path(member).name).write_bytes(sdk.read(member))
        with ZipFile(base) as source:
            for name in ("runtime/node.exe", "app.cjs", "web/index.html", "formats/index.html"):
                source.getinfo(name)
            png = source.read("web/moyin-96.png")
            icon = struct.pack("<HHHBBBBHHII", 0, 1, 1, 96, 96, 0, 0, 1, 32, len(png), 22) + png
            (work / "app.ico").write_bytes(icon)
            run([compiler, "/nologo", "/target:winexe", "/platform:x64", "/optimize+", "/utf8output",
                 "/codepage:65001", "/win32icon:app.ico", "/win32manifest:" + str(root / "desktop" / "app.manifest"),
                 "/out:墨隐.exe", "/reference:System.Windows.Forms.dll,System.Drawing.dll," + CORE + "," + FORMS,
                 root / "desktop" / "Desktop.cs", root / "desktop" / "ServiceJob.cs"], cwd=work, check=True)
            staged = work / dest.name
            with ZipFile(staged, "w", ZIP_DEFLATED) as bundle:
                for info in source.infolist():
                    with source.open(info) as src, bundle.open(info, "w") as dst:
                        copyfileobj(src, dst)
                for name in ["墨隐.exe", CORE, FORMS, "WebView2Loader.dll"]:
                    bundle.write(work / name, name)
                for name in ("LICENSE.txt", "NOTICE.txt"):
                    bundle.write(work / name, "licenses/WebView2-" + name)
                bundle.write(root / "desktop" / "桌面版使用说明.md", "桌面版使用说明.md")
            with ZipFile(staged) as bundle:
                if bundle.testzip():
                    raise ValueError("Desktop ZIP failed verification")
            staged.replace(dest)
    checksum = digest(dest)
    dest.with_suffix(".sha256").write_text(f"{checksum}  {dest.name}\n", encoding="utf-8")
    print(dest, checksum)


if __name__ == "__main__":
    main()
