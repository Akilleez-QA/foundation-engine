import hashlib
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=ROOT).decode().split("\0")
    files = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
             for name in sorted(set(paths) - {"", "SOURCE-MANIFEST.json", "PR_BODY.md"})}
    raw = (json.dumps({"schema": "foundation-engine-source-manifest/1",
                       "version": json.loads((ROOT / "package.json").read_text())["version"],
                       "files": files}, sort_keys=True, separators=(",", ":")) + "\n").encode()
    target = ROOT / "SOURCE-MANIFEST.json"
    if sys.argv[1:] == ["--check"]:
        if not target.exists() or target.read_bytes() != raw:
            raise SystemExit("SOURCE-MANIFEST.json is stale; stage source files and run python3 -B tools/build_manifest.py")
    elif not sys.argv[1:]:
        target.write_bytes(raw)
    else:
        raise SystemExit("usage: python3 -B tools/build_manifest.py [--check]")
    print(json.dumps({"files": len(files), "sha256": hashlib.sha256(raw).hexdigest()}))


if __name__ == "__main__":
    main()
