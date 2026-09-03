# Evomedia.net evo.platform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""Render every tracked .md to a .txt twin with the markdown markup removed.

The .txt twins exist for terminals, pagers and anywhere markdown doesn't
render. They are generated - never edit one by hand:

    python scripts/md_txt.py          # rewrite every twin
    python scripts/md_txt.py --check  # exit 1 if any twin is out of sync

CI runs --check, so a .md edit that forgets to regenerate fails the build
rather than shipping a stale mirror. Ported from evo.locate's readme_txt.py,
generalised to walk the repo, with two fixes: bold that spans a line break
is now stripped (the original worked line by line and left the markers),
and horizontal rules are dropped (they are markup, not content).

Rendering rules, matching the fleet convention:
  headings underlined with = (h1) or - (h2 and below); links as text (url);
  code blocks indented, fences removed; bold, italic and inline-code markers
  stripped; tables and em dashes kept - they are content, not markup.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Never twinned: Claude-internal machinery, and anything vendored.
SKIP_PARTS = {"node_modules", ".claude"}
SKIP_NAMES = {"CLAUDE.md"}


def _inline(text: str) -> str:
    """Strip inline markup. Applied to a whole prose segment, not a single
    line, so bold and inline code that span a line break are still caught."""
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)  # images -> alt text
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)  # links -> text (url)
    # Bold, may span lines and may contain italic: "**pin by version *and*
    # hash**" needs the non-greedy form, since [^*]+ cannot cross the inner
    # asterisks and would leave the outer markers behind.
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text, flags=re.DOTALL)
    text = re.sub(r"(?<!\*)\*([^*\n]+)\*(?!\*)", r"\1", text)  # italic
    text = re.sub(r"`([^`]+)`", r"\1", text)  # inline code, may span lines
    return text


_HR = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")


def _prose(segment: str) -> list[str]:
    """Render a run of non-code lines: strip inline markup across the whole
    segment first, then handle headings and rules per line."""
    out: list[str] = []
    for line in _inline(segment).splitlines():
        heading = re.match(r"^(#{1,6})\s+(.*)$", line)
        if heading:
            text = heading.group(2).strip()
            out.append(text)
            out.append(("=" if len(heading.group(1)) == 1 else "-") * len(text))
            continue
        if _HR.match(line):
            continue
        out.append(line)
    return out


def render(md: str) -> str:
    out: list[str] = []
    prose: list[str] = []
    in_fence = False

    def flush() -> None:
        if prose:
            out.extend(_prose("\n".join(prose)))
            prose.clear()

    for line in md.splitlines():
        if line.lstrip().startswith("```"):
            # Drop the fence markers; the code itself stays, indented so it
            # still reads as a block without the backticks.
            flush()
            in_fence = not in_fence
            continue
        if in_fence:
            out.append(("    " + line) if line else "")
            continue
        prose.append(line)
    flush()

    text = "\n".join(out)
    text = re.sub(r"\n{3,}", "\n\n", text)
    # Trim blank lines only: a bare .strip() would also eat the indent of a
    # code block that happens to open the document.
    return text.strip("\n") + "\n"


def sources() -> list[Path]:
    """Every tracked .md, so an untracked draft never grows a twin."""
    listing = subprocess.run(
        ["git", "ls-files", "--", "*.md"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout.split("\n")
    paths = []
    for rel in filter(None, listing):
        p = ROOT / rel
        if p.name in SKIP_NAMES or SKIP_PARTS & set(p.parts):
            continue
        paths.append(p)
    return sorted(paths)


def main() -> int:
    check = "--check" in sys.argv
    stale: list[str] = []
    written = 0
    for md in sources():
        rendered = render(md.read_text(encoding="utf-8"))
        target = md.with_suffix(".txt")
        rel = target.relative_to(ROOT).as_posix()
        if check:
            current = target.read_text(encoding="utf-8") if target.exists() else ""
            if current != rendered:
                stale.append(rel)
            continue
        target.write_text(rendered, encoding="utf-8", newline="\n")
        written += 1
    if check:
        if stale:
            print("Out of sync - run: python scripts/md_txt.py")
            for rel in stale:
                print(f"  {rel}")
            return 1
        print("All .txt twins are in sync")
        return 0
    print(f"Wrote {written} twin(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
