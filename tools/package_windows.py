"""Build the Windows distribution from committed source and a matching runtime."""
from argparse import ArgumentParser
from hashlib import file_digest
from pathlib import Path
import re
from subprocess import check_output
from zipfile import ZipFile, ZIP_DEFLATED


def main():
    parser = ArgumentParser()
    parser.add_argument("runtime", type=Path, help="Windows runtime from the full offline distribution")
    parser.add_argument("--version", default="v0.1.1")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    runtime = args.runtime.resolve(strict=True)
    for required in ("node.exe", "llama-server.exe", "ggml.dll", "llama.dll"):
        if not (runtime / required).is_file():
            parser.error(f"Missing runtime component: {required}")
    dest = root / "dist"
    dest.mkdir(exist_ok=True)
    if not re.fullmatch(r"v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", args.version):
        parser.error("Expected a release tag such as v0.1.1")
    package = dest / f"moyin-windows-x64-{args.version}.zip"
    tracked = check_output(["git", "ls-tree", "-rz", "--name-only", "HEAD"], cwd=root)
    with ZipFile(package, "w", ZIP_DEFLATED, compresslevel=6) as bundle:
        for entry in tracked.decode("utf-8").split("\0"):
            if not entry or entry.startswith((".", "tools/")):
                continue
            data = check_output(["git", "show", f"HEAD:{entry}"], cwd=root)
            bundle.writestr(entry, data)
        for binary in sorted(runtime.iterdir()):
            if binary.is_file() and binary.suffix.lower() in {".dll", ".exe"}:
                bundle.write(binary, "runtime/" + binary.name)
        bundle.mkdir("models/")
    with ZipFile(package) as bundle:
        if bundle.testzip() is not None:
            raise ValueError("Archive verification failed")
    with package.open("rb") as stream:
        digest = file_digest(stream, "sha256").hexdigest()
    (dest / "SHA256SUMS.txt").write_text(f"{digest}  {package.name}\n", encoding="ascii")
    print(package.name, package.stat().st_size, digest)


if __name__ == "__main__":
    main()
