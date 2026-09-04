from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, TypedDict

if TYPE_CHECKING:
    from collections.abc import Mapping


class AuthEntry(TypedDict):
    type: str
    key: str


@dataclass(frozen=True)
class ProviderAuthSpec:
    secret_name: str
    auth_names: tuple[str, ...]
    plugin: str | None = None


_PROVIDER_AUTH_SPECS = {
    "minimax-coding-plan": ProviderAuthSpec(
        secret_name="MINIMAX_API_KEY",
        auth_names=("minimax", "minimax-coding-plan"),
        plugin="minimax-auth-plugin.js",
    ),
    "fireworks-ai": ProviderAuthSpec(
        secret_name="FIREWORKS_API_KEY",
        auth_names=("fireworks", "fireworks-ai"),
    ),
    "opencode-go": ProviderAuthSpec(
        secret_name="OPENCODE_GO_API_KEY",
        auth_names=("opencode-go",),
    ),
    "zai-coding-plan": ProviderAuthSpec(
        secret_name="ZHIPU_API_KEY",
        auth_names=("zai-coding-plan",),
    ),
    "ollama-cloud": ProviderAuthSpec(
        secret_name="OLLAMA_CLOUD_API_KEY",
        auth_names=("ollama-cloud",),
    ),
}


def provider_auth_entries(provider: str, environment: Mapping[str, str]) -> dict[str, AuthEntry]:
    """Build OpenCode auth entries for a selected API-key provider."""
    spec = _PROVIDER_AUTH_SPECS.get(provider)
    if spec is None:
        return {}

    api_key = environment.get(spec.secret_name)
    if not api_key:
        raise RuntimeError(f"{spec.secret_name} is required for provider {provider}")

    return {name: {"type": "api", "key": api_key} for name in spec.auth_names}


def provider_plugin(provider: str) -> str | None:
    """Return the bundled plugin required by a selected provider, if any."""
    spec = _PROVIDER_AUTH_SPECS.get(provider)
    return spec.plugin if spec else None


def model_route(provider: str, model: str) -> str:
    """Translate a catalog model into the route expected by OpenCode."""
    if provider == "fireworks-ai":
        return f"fireworks-ai/accounts/fireworks/routers/{model}"
    if provider == "ollama-cloud":
        cloud_model = model if model.endswith(":cloud") else f"{model}:cloud"
        return f"ollama-cloud/{cloud_model}"
    return f"{provider}/{model}"


def write_auth_entries(
    entries: Mapping[str, AuthEntry], *, home: Path | None = None
) -> Path | None:
    """Merge auth entries into OpenCode's auth file using an atomic secure write."""
    if not entries:
        return None

    auth_dir = (home or Path.home()) / ".local" / "share" / "opencode"
    auth_dir.mkdir(parents=True, exist_ok=True)
    auth_file = auth_dir / "auth.json"
    tmp_file = auth_dir / ".auth.json.tmp"

    existing_entries: dict[str, object] = {}
    if auth_file.exists():
        try:
            existing = json.loads(auth_file.read_text())
        except (OSError, json.JSONDecodeError) as error:
            raise RuntimeError(f"Cannot read existing OpenCode auth file: {auth_file}") from error
        if not isinstance(existing, dict):
            raise RuntimeError(f"OpenCode auth file must contain an object: {auth_file}")
        existing_entries = existing

    merged_entries = {**existing_entries, **entries}
    payload = json.dumps(merged_entries).encode()
    fd = os.open(str(tmp_file), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        if hasattr(os, "fchmod"):
            os.fchmod(fd, 0o600)
        offset = 0
        while offset < len(payload):
            offset += os.write(fd, payload[offset:])
        os.close(fd)
        fd = -1
        tmp_file.replace(auth_file)
    finally:
        if fd >= 0:
            os.close(fd)
        tmp_file.unlink(missing_ok=True)

    return auth_file
