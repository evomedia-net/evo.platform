# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Compute the next 5-segment version, and optionally write the stamp.

The scheme is `v{major}.{rc}.{beta}.{alpha}.{build}`, and its one rule that is
easy to get wrong: **bumping a stage zeroes every lower segment, build
included.** A release makes `v{major+1}.0.0.0.0`; an rc makes rc+1 with beta,
alpha and build at zero; and so on down. Only a build bump leaves everything
to its left alone.

That rule is the whole reason this is a script with tests rather than a line
of shell. Getting it wrong produces a version that sorts correctly, reads
plausibly, and is wrong - `v0.0.2.0.31` after a beta bump looks fine until you
notice build 31 belongs to the beta before it.

Usage:
    python scripts/bump_version.py --show
    python scripts/bump_version.py build           # prints the next version
    python scripts/bump_version.py beta --write    # and writes the stamp
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# The stamp lives with the service, not at the repo root: that directory is
# the project root as the deploy tooling sees it, and the Docker build copies
# it from there into the runtime image.
STAMP = Path(__file__).resolve().parent.parent / "platform" / "build-version.json"

# Left to right, most significant first. The index of a segment is also the
# number of segments to its left that a bump must leave untouched.
SEGMENTS = ("major", "rc", "beta", "alpha", "build")

VERSION_RE = re.compile(r"^v(\d+)\.(\d+)\.(\d+)\.(\d+)\.(\d+)$")


def parse(version: str) -> list[int]:
    m = VERSION_RE.match(version.strip())
    if not m:
        raise ValueError(
            f"not a 5-segment version: {version!r} (expected vMAJOR.RC.BETA.ALPHA.BUILD)"
        )
    return [int(g) for g in m.groups()]


def format_version(parts: list[int]) -> str:
    return "v" + ".".join(str(p) for p in parts)


def bump(version: str, segment: str) -> str:
    """The next version after bumping `segment`, zeroing everything below it."""
    if segment == "release":
        segment = "major"
    if segment not in SEGMENTS:
        raise ValueError(f"unknown segment {segment!r} (expected one of {', '.join(SEGMENTS)})")
    parts = parse(version)
    i = SEGMENTS.index(segment)
    parts[i] += 1
    for lower in range(i + 1, len(SEGMENTS)):
        parts[lower] = 0
    return format_version(parts)


def read_stamp(path: Path = STAMP) -> str:
    return json.loads(path.read_text(encoding="utf-8"))["version"]


def write_stamp(version: str, path: Path = STAMP) -> None:
    """Rewrite only the version, preserving the file's existing formatting.

    A json.dump would reformat the whole file and show up as an unrelated diff
    on a release commit that should touch one value.
    """
    text = path.read_text(encoding="utf-8")
    current = read_stamp(path)
    if current not in text:
        raise ValueError(f"could not find {current!r} in {path}")
    path.write_text(text.replace(current, version, 1), encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument(
        "segment",
        nargs="?",
        default="build",
        choices=[*SEGMENTS, "release"],
        help="which segment to bump (default: build)",
    )
    ap.add_argument("--show", action="store_true", help="print the current version and exit")
    ap.add_argument("--write", action="store_true", help="write the new version to the stamp")
    args = ap.parse_args(argv)

    current = read_stamp()
    if args.show:
        print(current)
        return 0

    nxt = bump(current, args.segment)
    if args.write:
        write_stamp(nxt)
        print(f"{current} -> {nxt}", file=sys.stderr)
    print(nxt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
