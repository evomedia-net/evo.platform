# Evomedia.net EvoPlatform — https://github.com/evomedia-net/evo.platform
# Created by Kelly Michels · dev@evomedia.net
# Licensed under the MIT License. See LICENSE.

"""The version arithmetic, which is the part a release gets wrong silently.

A bump that fails to zero the segments below it produces a version that sorts
correctly and reads plausibly and is still wrong: `v0.0.2.0.31` after a beta
bump looks fine until you notice build 31 belongs to the beta before it. None
of that surfaces as an error, which is why it is tested rather than trusted.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

BS = chr(92)  # a backslash, built rather than typed

from bump_version import STAMP, bump, format_version, parse, read_stamp, write_stamp


class TestParse:
    def test_reads_all_five_segments(self):
        assert parse("v1.2.3.4.5") == [1, 2, 3, 4, 5]

    def test_reads_multi_digit_segments(self):
        assert parse("v10.0.1.0.247") == [10, 0, 1, 0, 247]

    @pytest.mark.parametrize(
        "bad",
        [
            "1.2.3.4.5",  # no leading v
            "v1.2.3.4",  # four segments
            "v1.2.3.4.5.6",  # six
            "v1.2.3.4.x",  # not a number
            "v1.2.3.4.-1",  # negative
            "",
            "latest",
        ],
    )
    def test_refuses_anything_that_is_not_the_scheme(self, bad):
        with pytest.raises(ValueError, match="5-segment"):
            parse(bad)

    def test_round_trips(self):
        assert format_version(parse("v0.0.1.0.18")) == "v0.0.1.0.18"


class TestBump:
    def test_build_leaves_everything_to_its_left(self):
        assert bump("v0.0.1.0.18", "build") == "v0.0.1.0.19"

    def test_build_carries_past_nine_without_rolling_over(self):
        # Segments are integers, not digits: 9 -> 10, never 9 -> 0 with a carry.
        assert bump("v0.0.1.0.9", "build") == "v0.0.1.0.10"
        assert bump("v0.0.1.0.99", "build") == "v0.0.1.0.100"

    # Each stage bump zeroes every segment below it. This is the rule the
    # whole script exists for.
    @pytest.mark.parametrize(
        "segment,expected",
        [
            ("alpha", "v2.3.4.6.0"),
            ("beta", "v2.3.5.0.0"),
            ("rc", "v2.4.0.0.0"),
            ("major", "v3.0.0.0.0"),
            ("release", "v3.0.0.0.0"),  # alias
        ],
    )
    def test_a_stage_bump_zeroes_everything_below_it(self, segment, expected):
        assert bump("v2.3.4.5.99", segment) == expected

    def test_the_beta_stage_this_project_is_on(self):
        assert bump("v0.0.1.0.18", "beta") == "v0.0.2.0.0"

    def test_a_release_from_beta_starts_the_next_major_clean(self):
        assert bump("v0.0.1.0.247", "release") == "v1.0.0.0.0"

    def test_refuses_an_unknown_segment(self):
        with pytest.raises(ValueError, match="unknown segment"):
            bump("v0.0.1.0.18", "patch")

    def test_refuses_to_bump_a_malformed_current_version(self):
        with pytest.raises(ValueError, match="5-segment"):
            bump("0.0.1.0.18", "build")


class TestStamp:
    def test_the_repo_stamp_is_readable_and_well_formed(self):
        # Also proves the stamp is where the script, the Dockerfile and the
        # deploy tooling all expect it; moving it breaks this first.
        assert STAMP.exists(), f"no stamp at {STAMP}"
        parse(read_stamp())

    def test_writing_changes_only_the_version(self, tmp_path):
        # The file is hand-formatted; a json.dump would reformat it and turn a
        # one-value release commit into a whole-file diff.
        p = tmp_path / "build-version.json"
        original = '{\n    "version":  "v0.0.1.0.18"\n}\n'
        p.write_text(original, encoding="utf-8")

        write_stamp("v0.0.1.0.19", p)

        assert p.read_text(encoding="utf-8") == '{\n    "version":  "v0.0.1.0.19"\n}\n'
        assert json.loads(p.read_text(encoding="utf-8"))["version"] == "v0.0.1.0.19"

    def test_writing_refuses_a_stamp_whose_text_it_cannot_match(self, tmp_path):
        # JSON escapes let the parsed value differ from the bytes on disk:
        # an escaped "0" reads back as "0", so the literal "v1.0.0.0.0"
        # never appears in the file. A blind replace would silently write
        # nothing, so the guard refuses instead. The backslash is built with
        # chr() because every quoting layer between here and the file - the
        # editor, the shell, Python's own literal parser - will happily
        # resolve a typed escape before the file ever sees it.
        escaped = '{"version": "v1.0.0.0.' + BS + 'u0030"}'
        assert "v1.0.0.0.0" not in escaped  # the whole point of the case

        p = tmp_path / "build-version.json"
        p.write_text(escaped, encoding="utf-8")
        assert read_stamp(p) == "v1.0.0.0.0"

        with pytest.raises(ValueError, match="could not find"):
            write_stamp("v1.0.0.0.1", p)

    def test_writing_a_stamp_that_is_not_there_raises(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            write_stamp("v1.0.0.0.1", tmp_path / "missing.json")
