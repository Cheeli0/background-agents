"""Opt-in wire tests: OPENCODE_TEST_BINARY=/path/to/opencode pytest ... -v.

Uses the pinned real OpenCode, an isolated catalog/config, and fake localhost providers.
Only synthetic requests are captured; no real provider keys or user context are used.

Fixture: public subset of https://models.opencode.ai/api.json, retrieved 2026-09-09.
Source SHA-256: a55f5a544d356a15a6491bc3293f2dabb692a381e65cce69fee4741de9636733
GPT-6 Sol and Luna added from the 2026-09-22 retrieval.
Source SHA-256: c9d3dc07540cf91a7b7362a3b42943132965f4ee6e8374113ee4f0f7b56b3d90
Claude Opus 5.5 added from the 2026-09-23 retrieval.
Source SHA-256: e20acec396a73dc3db45d0eca7f0ede5bff28f09f002ba96ce7b1b566de7b6d0
Claude Sonnet 5.5 added from the 2026-09-28 retrieval.
Source SHA-256: 06e0071dd4ae9c9da2db1fabf28eb4994914fefdc5dd10270a5b340c88a49aec
GPT-6.1 Sol added from the 2026-09-29 retrieval.
Source SHA-256: e4677e698a53d3b8b11c569c0ecc2f5722cd8126677bf5f7dbff23daf942a17b
GPT-6.1 Terra added from the 2026-11-04 retrieval.
Source SHA-256: 3c98c4ea4ce2fc866e8f7cf858f7c79ce96d12aa190b6f26b9af77b448519b02
OpenCode Zen and Go models with efforts, and their Gemini models, added from the 2026-11-10 retrieval.
Source SHA-256: 4f9cc07fff594ef0745e8c243fc0c5a0b68b2279b0d062cca5c8a3df6382e0ed
GPT-6.2 Astra and GPT-6.2 Sol added from the 2026-11-17 retrieval.
Source SHA-256: d5d6ff2fff92fcfe45566f38f9c559c71ecc63a1b400b2e305ef7545b70a5c3a
Subset SHA-256: 4625f538690cc7df8d4625660803b229979a03a234de6cfd0e660d170a8f7c5c
Reconcile this frozen fixture with shared model/effort definitions when changing
models or the binary. Mocks verify serialization, not live provider acceptance.
"""

import json
import os
import shutil
import socket
import subprocess
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from tests.opencode_version import OPENCODE_VERSION
from tests.test_prompt_stream import make_stream

pytest_plugins = ["tests.test_reasoning_config"]

BINARY = os.environ.get("OPENCODE_TEST_BINARY")
pytestmark = pytest.mark.skipif(not BINARY, reason="set OPENCODE_TEST_BINARY for wire tests")
CATALOG = Path(__file__).parent / "fixtures/reasoning-models.json"
OPENCODE_GATEWAYS = ("opencode", "opencode-go")
# The agent-level effort the wire server configures; a prompt without a usable
# variant falls back to it.
AGENT_DEFAULT_EFFORT = "high"
# Efforts the shared catalog offers on OpenCode Zen and Go. The shared package's
# models.test.ts keeps this file equal to the catalog. Each must be a variant
# OpenCode derives for the model; the field it lands in depends on the SDK the
# gateway routes the model to.
OPENCODE_GATEWAY_EFFORTS = json.loads(
    (Path(__file__).parent / "fixtures/opencode-gateway-efforts.json").read_text()
)


def openai_events(model):
    item = {
        "id": "msg_test",
        "type": "message",
        "role": "assistant",
        "status": "completed",
        "content": [{"type": "output_text", "text": "OK", "annotations": []}],
    }
    response = {
        "id": "resp_test",
        "object": "response",
        "status": "completed",
        "model": model,
        "output": [item],
        "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2},
    }
    return [
        {
            "type": "response.created",
            "response": {**response, "status": "in_progress", "output": []},
        },
        {
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {**item, "status": "in_progress", "content": []},
        },
        {
            "type": "response.output_text.delta",
            "item_id": item["id"],
            "output_index": 0,
            "content_index": 0,
            "delta": "OK",
        },
        {"type": "response.output_item.done", "output_index": 0, "item": item},
        {"type": "response.completed", "response": response},
    ]


def chat_completion_events(model):
    """Minimal OpenAI-compatible chat-completions stream that replies OK."""
    chunk = {"id": "chatcmpl_test", "object": "chat.completion.chunk", "created": 0, "model": model}
    return [
        {
            **chunk,
            "choices": [
                {"index": 0, "delta": {"role": "assistant", "content": "OK"}, "finish_reason": None}
            ],
        },
        {
            **chunk,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
        },
    ]


def google_events():
    """Minimal Gemini streamGenerateContent stream that replies OK."""
    return [
        {
            "candidates": [
                {"content": {"role": "model", "parts": [{"text": "OK"}]}, "finishReason": "STOP"}
            ],
            "usageMetadata": {
                "promptTokenCount": 1,
                "candidatesTokenCount": 1,
                "totalTokenCount": 2,
            },
        }
    ]


def anthropic_events(model):
    return [
        {
            "type": "message_start",
            "message": {
                "id": "msg_test",
                "type": "message",
                "role": "assistant",
                "content": [],
                "model": model,
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {"input_tokens": 1, "output_tokens": 0},
            },
        },
        {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}},
        {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": "OK"}},
        {"type": "content_block_stop", "index": 0},
        {
            "type": "message_delta",
            "delta": {"stop_reason": "end_turn", "stop_sequence": None},
            "usage": {"output_tokens": 1},
        },
        {"type": "message_stop"},
    ]


@pytest.fixture
async def wire_server(tmp_path, reasoning_config, request):
    assert subprocess.check_output([BINARY, "--version"], text=True).strip() == OPENCODE_VERSION
    captured = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            google = ":streamGenerateContent" in self.path
            if google:
                # Google's API names the model in the path, not the body.
                body["model"] = self.path.split("/models/", 1)[1].split(":", 1)[0]
            captured.append(
                {
                    key: body.get(key)
                    for key in (
                        "model",
                        "reasoning",
                        "thinking",
                        "output_config",
                        "reasoning_effort",
                        "generationConfig",
                        "system",
                        "tools",
                    )
                }
            )
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            if google:
                self.wfile.write(
                    "".join(
                        "data: " + json.dumps(event) + "\n\n" for event in google_events()
                    ).encode()
                )
                return
            if self.path.endswith("/chat/completions"):
                self.wfile.write(
                    "".join(
                        "data: " + json.dumps(event) + "\n\n"
                        for event in chat_completion_events(body["model"])
                    ).encode()
                    + b"data: [DONE]\n\n"
                )
                return
            events = (
                anthropic_events(body["model"])
                if self.path.endswith("/messages")
                else openai_events(body["model"])
            )
            self.wfile.write(
                "".join(
                    "event: " + event["type"] + "\ndata: " + json.dumps(event) + "\n\n"
                    for event in events
                ).encode()
            )

    mock = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=mock.serve_forever, daemon=True)
    thread.start()
    process = None
    try:
        config = reasoning_config
        if getattr(request, "param", None) == "memory":
            memory_file = tmp_path / "config/opencode/oi-memory.md"
            memory_file.parent.mkdir(parents=True, exist_ok=True)
            memory_file.write_text("# Memory\n\nWIRE_MEMORY_SENTINEL: prefer local verification.\n")
            config["instructions"] = [str(memory_file)]
            source = Path(__file__).parents[1] / "src/sandbox_runtime/tools"
            destination = tmp_path / ".opencode/tool"
            destination.mkdir(parents=True)
            for name in (
                "memory_read.js",
                "memory_write.js",
                "memory_search.js",
                "_memory.js",
                "_memory-contract.js",
                "_bridge-client.js",
            ):
                shutil.copy(source / name, destination / name)
        if getattr(request, "param", None) != "no_agent_default":
            config["agent"] = {"build": {"options": {"reasoningEffort": AGENT_DEFAULT_EFFORT}}}
        for provider in ("openai", "anthropic", *OPENCODE_GATEWAYS):
            config["provider"].setdefault(provider, {})["options"] = {
                "baseURL": f"http://127.0.0.1:{mock.server_port}/v1",
                "apiKey": "test-only",
            }
        env = {key: os.environ[key] for key in ("PATH", "HOME", "SYSTEMROOT") if key in os.environ}
        env.update(
            {
                "XDG_CONFIG_HOME": str(tmp_path / "config"),
                "XDG_DATA_HOME": str(tmp_path / "data"),
                "XDG_CACHE_HOME": str(tmp_path / "cache"),
                "XDG_STATE_HOME": str(tmp_path / "state"),
                "OPENCODE_CONFIG_DIR": str(tmp_path / "config/opencode"),
                "OPENCODE_MODELS_PATH": str(CATALOG),
                "OPENCODE_DISABLE_MODELS_FETCH": "1",
                "OPENCODE_CONFIG_CONTENT": json.dumps(config),
                "OPENCODE_CLIENT": "serve",
                "OPENAI_API_KEY": "test-only",
                "ANTHROPIC_API_KEY": "test-only",
                "OPENCODE_API_KEY": "test-only",
                "SANDBOX_AUTH_TOKEN": "test-only",
                "SESSION_CONFIG": '{"session_id":"wire-test"}',
            }
        )
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        process = subprocess.Popen(
            [BINARY, "serve", "--hostname", "127.0.0.1", "--port", str(port)],
            cwd=tmp_path,
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        def call(path, body=None, timeout_seconds=30):
            request = urllib.request.Request(
                f"http://127.0.0.1:{port}" + path,
                data=json.dumps(body).encode() if body is not None else None,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
                return json.load(response)

        deadline = time.monotonic() + 30
        while True:
            try:
                call("/global/health", timeout_seconds=1)
                break
            except OSError:
                if process.poll() is not None or time.monotonic() >= deadline:
                    pytest.fail("isolated OpenCode server did not become healthy")
                time.sleep(0.1)
        yield call, captured
    finally:
        if process is not None:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=10)
        mock.shutdown()
        mock.server_close()
        thread.join(timeout=5)


def submit(call, captured, model, effort, session=None):
    if session is None:
        session = call("/session", {"title": "Reasoning contract"})["id"]
    stream = make_stream()
    stream._attachment_processor.build_file_parts.return_value = []
    body = stream._build_prompt_request_body(
        "Reply only OK. Do not use tools.", model, reasoning_effort=effort
    )
    captured.clear()
    result = call(f"/session/{session}/message", body)
    assert not result["info"].get("error"), result["info"].get("error", {}).get("name")
    provider, model_id = model.split("/", 1)
    sent = [item for item in captured if item["model"] == model_id]
    assert sent, f"no outbound request for {provider}/{model_id}"
    return sent[-1], session


@pytest.mark.parametrize("wire_server", ["memory"], indirect=True)
async def test_memory_text_and_tool_contract_reach_real_opencode_provider_request(wire_server):
    call, captured = wire_server
    sent, _ = submit(call, captured, "anthropic/claude-sonnet-4-6", None)
    assert "WIRE_MEMORY_SENTINEL: prefer local verification." in json.dumps(sent["system"])
    tools = {tool["name"]: tool for tool in sent["tools"]}
    assert {"memory_read", "memory_write", "memory_search"} <= tools.keys()
    assert tools["memory_search"]["input_schema"]["required"] == ["query"]
    assert "environmentId" not in tools["memory_search"]["input_schema"]["properties"]
    assert "memoryId" in tools["memory_read"]["input_schema"]["properties"]
    assert "ownerUserId" not in tools["memory_write"]["input_schema"]["properties"]
    assert "environmentId" not in tools["memory_write"]["input_schema"]["properties"]


async def test_all_fixture_efforts_reach_provider(wire_server):
    call, captured = wire_server
    catalog = json.loads(CATALOG.read_text())
    for provider, group in catalog.items():
        if provider in OPENCODE_GATEWAYS:
            continue
        for model_id, model in group["models"].items():
            manual = model_id in {"claude-haiku-4-5", "claude-sonnet-4-5", "claude-opus-4-5"}
            efforts = (
                ["high", "max"]
                if manual
                else next(
                    option["values"]
                    for option in model["reasoning_options"]
                    if option["type"] == "effort"
                )
            )
            for effort in efforts:
                sent, _ = submit(call, captured, f"{provider}/{model_id}", effort)
                context = f"{provider}/{model_id} {effort}"
                if provider == "openai":
                    assert sent["reasoning"]["effort"] == effort, context
                elif manual:
                    assert sent["thinking"] == {
                        "type": "enabled",
                        "budget_tokens": 16000 if effort == "high" else 31999,
                    }, context
                    expected = (
                        {"effort": "high"}
                        if model_id == "claude-opus-4-5" and effort == "high"
                        else None
                    )
                    assert sent["output_config"] == expected, context
                else:
                    assert sent["thinking"]["type"] == "adaptive", context
                    assert sent["output_config"]["effort"] == effort, context


async def test_defaults_and_switching(wire_server):
    call, captured = wire_server
    # The configured agent's High default must survive omission and yield to a variant.
    sent, session = submit(call, captured, "openai/gpt-5.6-sol", None)
    assert sent["reasoning"]["effort"] == "high"
    sent, session = submit(call, captured, "openai/gpt-5.6-sol", "low", session)
    assert sent["reasoning"]["effort"] == "low"
    sent, session = submit(call, captured, "anthropic/claude-opus-4-5", "max", session)
    assert sent["thinking"] == {"type": "enabled", "budget_tokens": 31999}
    sent, _ = submit(call, captured, "anthropic/claude-haiku-4-5", None)
    assert sent["thinking"] is None


async def test_unsupported_request_options_do_not_override_defaults(wire_server):
    call, captured = wire_server
    base = {
        "model": {"providerID": "openai", "modelID": "gpt-5.6-sol"},
        "parts": [{"type": "text", "text": "Reply only OK. Do not use tools."}],
    }
    for effort in ("low", "max"):
        cases = [
            {**base, "model": {**base["model"], "options": {"reasoningEffort": effort}}},
            {**base, "reasoningEffort": effort},
            {**base, "options": {"reasoningEffort": effort}},
            {**base, "providerOptions": {"openai": {"reasoningEffort": effort}}},
        ]
        for body in cases:
            session = call("/session", {"title": "Reasoning contract"})["id"]
            captured.clear()
            result = call(f"/session/{session}/message", body)
            assert not result["info"].get("error")
            assert captured[-1]["reasoning"]["effort"] == "high"
    for model in ("claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-5"):
        session = call("/session", {"title": "Reasoning contract"})["id"]
        captured.clear()
        result = call(
            f"/session/{session}/message",
            {
                "model": {
                    "providerID": "anthropic",
                    "modelID": model,
                    "options": {"thinking": {"type": "enabled", "budgetTokens": 31999}},
                },
                "parts": base["parts"],
            },
        )
        assert not result["info"].get("error")
        assert captured[-1]["thinking"] is None


@pytest.mark.parametrize("wire_server", ["no_agent_default"], indirect=True)
async def test_opencode_gateway_efforts_reach_provider(wire_server):
    """Every catalog effort on a Zen or Go model reaches the gateway request.

    Runs without an agent default effort, so a dropped variant cannot pass by
    coincidence with the default.
    """
    call, captured = wire_server
    catalog = json.loads(CATALOG.read_text())
    fixture_models = {
        f"{provider}/{model_id}"
        for provider in OPENCODE_GATEWAYS
        for model_id in catalog[provider]["models"]
    }
    assert fixture_models == set(OPENCODE_GATEWAY_EFFORTS)
    for model, efforts in OPENCODE_GATEWAY_EFFORTS.items():
        provider, model_id = model.split("/", 1)
        npm = (catalog[provider]["models"][model_id].get("provider") or {}).get("npm")
        sent, _ = submit(call, captured, model, None)
        assert sent["reasoning_effort"] is None, model
        if npm == "@ai-sdk/google":
            # OpenCode sends Gemini's high thinking level when no variant is
            # chosen; the shared catalog records that as the default.
            thinking = sent["generationConfig"]["thinkingConfig"]
            assert thinking["thinkingLevel"] == "high", model
        for effort in efforts:
            sent, _ = submit(call, captured, model, effort)
            context = f"{model} {effort}"
            if npm == "@ai-sdk/google":
                thinking = sent["generationConfig"]["thinkingConfig"]
                assert thinking["thinkingLevel"] == effort, context
            elif npm == "@ai-sdk/openai":
                assert sent["reasoning"]["effort"] == effort, context
            elif npm == "@ai-sdk/anthropic" and model_id == "qwen3.7-plus":
                # Budget-only model: OpenCode (pinned in OPENCODE_VERSION) maps its
                # high and max variants to these thinking budgets.
                assert sent["thinking"] == {
                    "type": "enabled",
                    "budget_tokens": 16000 if effort == "high" else 31999,
                }, context
            elif npm == "@ai-sdk/anthropic":
                assert sent["output_config"]["effort"] == effort, context
            else:
                assert sent["reasoning_effort"] == effort, context


async def test_opencode_ignores_a_variant_the_model_lacks(wire_server):
    """A variant the model lacks falls back to the agent default, not an error.

    An image's cached catalog can predate a model's effort options.
    """
    call, captured = wire_server
    sent, _ = submit(call, captured, "opencode/glm-5.2", "low")
    assert sent["reasoning_effort"] == AGENT_DEFAULT_EFFORT
