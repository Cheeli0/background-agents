import re
from pathlib import Path

from sandbox_runtime.runtime_manifest import RUNTIME_MANIFEST, RUNTIME_VERSION
from src.images.base import CACHE_BUSTER, OPENCODE_VERSION

REPO_ROOT = Path(__file__).parents[3]


def test_runtime_manifest_generation_matches_version() -> None:
    assert RUNTIME_VERSION.startswith(f"v{RUNTIME_MANIFEST['generation']}")
    assert CACHE_BUSTER == RUNTIME_VERSION
    assert RUNTIME_MANIFEST["minimumCompatibleGeneration"] <= RUNTIME_MANIFEST["generation"]
    assert RUNTIME_MANIFEST["minimumRebuildGeneration"] <= RUNTIME_MANIFEST["generation"]


def test_all_sandbox_builders_pin_opencode_with_glm_5_3_flash() -> None:
    version_patterns = {
        "modal": OPENCODE_VERSION,
        "daytona": _extract_version(
            REPO_ROOT / "packages/daytona-infra/src/toolchain.py",
            r'OPENCODE_VERSION = "([^"]+)"',
        ),
        "e2b": _extract_version(
            REPO_ROOT / "packages/e2b-infra/e2b.Dockerfile",
            r"ARG OPENCODE_VERSION=([^\s]+)",
        ),
        "opencomputer": _extract_version(
            REPO_ROOT / "packages/opencomputer-infra/src/build-template.ts",
            r'const OPENCODE_VERSION = "([^"]+)"',
        ),
        "vercel": _extract_version(
            REPO_ROOT / "packages/control-plane/src/sandbox/providers/vercel/bootstrap.ts",
            r'OPENCODE_VERSION="([^"]+)"',
        ),
    }

    assert version_patterns == dict.fromkeys(version_patterns, "1.18.23")
    assert RUNTIME_MANIFEST == {
        "runtimeVersion": "v63-zai-coding-plan-auth",
        "generation": 63,
        "minimumCompatibleGeneration": 63,
        "minimumRebuildGeneration": 63,
    }


def _extract_version(path: Path, pattern: str) -> str:
    match = re.search(pattern, path.read_text())
    assert match is not None
    return match.group(1)
