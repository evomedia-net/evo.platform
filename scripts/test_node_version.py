"""Every declaration of "which Node" must agree (#276).

The numbers drifted apart quietly and stayed that way: CI ran Node 20 while
production ran 22, `cli` and `sdk-node` claimed `>=18` for a runtime that went
end-of-life in April 2025, and nothing anywhere noticed. Nothing could - a
version mismatch does not fail a build, it just means the build proves
something about a runtime nobody uses.

That is the specific shape of bug worth a test: not one that breaks loudly, but
one whose whole cost is that a green suite stops meaning what you think it
means.

Deliberately regex rather than PyYAML and JSON parsers throughout. The CI job
that runs this installs pytest and nothing else, and a guard that needs its own
dependency is a guard that gets skipped. The patterns are pinned tightly enough
that a real edit cannot slip past them.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
CI = ROOT / ".github" / "workflows" / "ci.yml"
DOCKERFILE = ROOT / "platform" / "Dockerfile"
NVMRC = ROOT / ".nvmrc"

#: Every package that states a floor. templates/next has none by design - it is
#: copied into a consumer's project and the version is then theirs.
PACKAGES = ("platform", "cli", "packages/sdk-node")


def ci_text() -> str:
    return CI.read_text(encoding="utf-8")


def declared_node_version() -> str:
    """The single NODE_VERSION the workflow defines."""
    m = re.search(r'^env:\n(?:.*\n)*?\s+NODE_VERSION:\s*"?(\d+)"?\s*$',
                  ci_text(), re.M)
    assert m, "ci.yml declares no workflow-level NODE_VERSION"
    return m.group(1)


def test_the_workflow_declares_one_node_version():
    assert declared_node_version().isdigit()


def test_no_step_hardcodes_a_node_version():
    """Four hardcoded copies are how this drifted in the first place."""
    stray = re.findall(r"node-version:\s*(?!\$\{\{)(\S+)", ci_text())
    assert not stray, (
        "setup-node steps must read ${{ env.NODE_VERSION }}, found: %s" % stray)


def test_every_setup_node_step_reads_the_declared_version():
    steps = len(re.findall(r"uses:\s*actions/setup-node@", ci_text()))
    reads = len(re.findall(r"node-version:\s*\$\{\{\s*env\.NODE_VERSION\s*\}\}",
                           ci_text()))
    assert steps > 0, "no setup-node steps found - has the workflow moved?"
    assert reads == steps, (
        f"{steps} setup-node step(s) but {reads} read env.NODE_VERSION")


def test_ci_tests_the_version_production_runs():
    """The whole point. A suite that never runs on the deployed runtime is
    evidence about a runtime nobody uses."""
    froms = re.findall(r"^FROM\s+node:(\d+)", DOCKERFILE.read_text(encoding="utf-8"),
                       re.M)
    assert froms, "platform/Dockerfile has no FROM node: line"
    assert len(set(froms)) == 1, f"Dockerfile stages disagree: {froms}"
    assert froms[0] == declared_node_version(), (
        f"production runs Node {froms[0]}, CI tests Node {declared_node_version()}")


def test_nvmrc_matches_so_local_development_does_too():
    assert NVMRC.exists(), "no .nvmrc - local development is pinned to nothing"
    assert NVMRC.read_text(encoding="utf-8").strip() == declared_node_version()


@pytest.mark.parametrize("pkg", PACKAGES)
def test_engines_claims_only_what_is_tested(pkg):
    """A floor nothing exercises is a promise, not a fact."""
    data = json.loads((ROOT / pkg / "package.json").read_text(encoding="utf-8"))
    claimed = data.get("engines", {}).get("node")
    assert claimed, f"{pkg} states no engines.node"
    m = re.fullmatch(r">=(\d+)", claimed.strip())
    assert m, f"{pkg} engines.node is {claimed!r}; expected a >=N floor"
    assert m.group(1) == declared_node_version(), (
        f"{pkg} claims Node {claimed} but CI only ever runs "
        f"{declared_node_version()}")
