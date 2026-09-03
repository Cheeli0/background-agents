from __future__ import annotations

import json

import pytest

from sandbox_runtime.provider_auth import (
    model_route,
    provider_auth_entries,
    provider_plugin,
    write_auth_entries,
)


@pytest.mark.parametrize(
    ("provider", "environment", "expected"),
    [
        (
            "minimax-coding-plan",
            {"MINIMAX_API_KEY": "minimax-secret"},
            {
                "minimax": {"type": "api", "key": "minimax-secret"},
                "minimax-coding-plan": {"type": "api", "key": "minimax-secret"},
            },
        ),
        (
            "fireworks-ai",
            {"FIREWORKS_API_KEY": "fireworks-secret"},
            {
                "fireworks": {"type": "api", "key": "fireworks-secret"},
                "fireworks-ai": {"type": "api", "key": "fireworks-secret"},
            },
        ),
        (
            "opencode-go",
            {"OPENCODE_GO_API_KEY": "go-secret"},
            {"opencode-go": {"type": "api", "key": "go-secret"}},
        ),
        (
            "ollama-cloud",
            {"OLLAMA_CLOUD_API_KEY": "ollama-secret"},
            {"ollama-cloud": {"type": "api", "key": "ollama-secret"}},
        ),
    ],
)
def test_provider_auth_entries(provider, environment, expected):
    assert provider_auth_entries(provider, environment) == expected


@pytest.mark.parametrize(
    ("provider", "secret_name"),
    [
        ("minimax-coding-plan", "MINIMAX_API_KEY"),
        ("fireworks-ai", "FIREWORKS_API_KEY"),
        ("opencode-go", "OPENCODE_GO_API_KEY"),
        ("ollama-cloud", "OLLAMA_CLOUD_API_KEY"),
    ],
)
def test_provider_auth_entries_requires_selected_provider_secret(provider, secret_name):
    with pytest.raises(RuntimeError, match=secret_name):
        provider_auth_entries(provider, {})


def test_provider_auth_entries_ignores_upstream_providers():
    assert provider_auth_entries("anthropic", {}) == {}


@pytest.mark.parametrize(
    ("provider", "model", "expected"),
    [
        (
            "fireworks-ai",
            "kimi-k2p5-turbo",
            "fireworks-ai/accounts/fireworks/routers/kimi-k2p5-turbo",
        ),
        ("ollama-cloud", "glm-5.1", "ollama-cloud/glm-5.1:cloud"),
        ("ollama-cloud", "glm-5.1:cloud", "ollama-cloud/glm-5.1:cloud"),
        ("opencode-go", "kimi-k2.6", "opencode-go/kimi-k2.6"),
        ("minimax-coding-plan", "MiniMax-M2.7", "minimax-coding-plan/MiniMax-M2.7"),
        ("anthropic", "claude-sonnet-4-6", "anthropic/claude-sonnet-4-6"),
    ],
)
def test_model_route(provider, model, expected):
    assert model_route(provider, model) == expected


def test_provider_plugin_is_scoped_to_minimax_coding_plan():
    assert provider_plugin("minimax-coding-plan") == "minimax-auth-plugin.js"
    assert provider_plugin("opencode") is None
    assert provider_plugin("fireworks-ai") is None


def test_write_auth_entries_merges_existing_auth(tmp_path):
    auth_dir = tmp_path / ".local" / "share" / "opencode"
    auth_dir.mkdir(parents=True)
    auth_file = auth_dir / "auth.json"
    auth_file.write_text(json.dumps({"anthropic": {"type": "api", "key": "existing"}}))

    result = write_auth_entries({"opencode-go": {"type": "api", "key": "new"}}, home=tmp_path)

    assert result == auth_file
    assert json.loads(auth_file.read_text()) == {
        "anthropic": {"type": "api", "key": "existing"},
        "opencode-go": {"type": "api", "key": "new"},
    }
    assert not (auth_dir / ".auth.json.tmp").exists()
