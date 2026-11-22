# Available Models

Superseded models are removed from the catalog rather than mapped to a successor. A session,
automation, integration setting or bot preference that still names a removed model is refused with
an error naming it; choose a supported model to continue.

Open-Inspect exposes these models in the model picker and integration preferences. The default
enabled set includes Anthropic and OpenAI models. Every other provider is opt-in under **Settings >
Models**. OpenAI and SuperGrok subscriptions are configured in **Settings > Provider Accounts**.
OpenCode Zen requires `OPENCODE_API_KEY`; OpenCode Go requires `OPENCODE_GO_API_KEY`; Kimi Coding
Plan requires `KIMI_API_KEY`; Z.AI Coding Plan requires `ZHIPU_API_KEY`; DeepSeek requires
`DEEPSEEK_API_KEY`. Other API-key providers require the matching global, environment, or repository
secret described below.

OpenAI, xAI and Anthropic session selectors offer provider policy, any active connected account, and
API-key mode. Automation editors can resolve defaults on each run or pin an account/API-key choice.
Unattended Slack, GitHub, Linear, and unpinned automation launches follow the provider's configured
unattended mode. For Anthropic that policy reaches only Claude Agent sessions. GitHub and Linear
launches run on the harness chosen in their integration settings, and Slack launches on the user's
App Home harness or the Slack setting, OpenCode by default. An OpenCode launch uses the API key.

## Harnesses

A session runs on one agent harness, fixed at create. Which models and which Anthropic
authentication a session can use depends on it:

| Harness      | Models            | Anthropic authentication                   |
| ------------ | ----------------- | ------------------------------------------ |
| OpenCode     | every model below | `ANTHROPIC_API_KEY`                        |
| Claude Agent | Anthropic models  | `ANTHROPIC_API_KEY` or a connected account |

See [Using the Claude Agent Harness](CLAUDE_AGENT.md).

## Anthropic

Anthropic models run on both harnesses. A connected Claude subscription (Settings > Provider
Accounts) applies only on the Claude Agent harness; OpenCode sessions use `ANTHROPIC_API_KEY`.

| Model ID                      | Display name      | Description                                       | Reasoning efforts             | Default effort |
| ----------------------------- | ----------------- | ------------------------------------------------- | ----------------------------- | -------------- |
| `anthropic/claude-haiku-4-5`  | Claude Haiku 4.5  | Fast and efficient                                | high, max                     | max            |
| `anthropic/claude-sonnet-5-5` | Claude Sonnet 5.5 | Latest Sonnet, fast and intelligent               | low, medium, high, xhigh, max | high           |
| `anthropic/claude-opus-5-5`   | Claude Opus 5.5   | Latest Opus, long-running agentic coding          | low, medium, high, xhigh, max | high           |
| `anthropic/claude-fable-5-1`  | Claude Fable 5.1  | Demanding reasoning and long-horizon agentic work | low, medium, high, xhigh, max | high           |

## OpenAI

OpenAI models support connected ChatGPT provider accounts or `OPENAI_API_KEY` mode. See
[Using OpenAI Models](OPENAI_MODELS.md) for account setup and coexistence details.

| Model ID               | Display name  | Description                                         | Reasoning efforts                   | Default effort |
| ---------------------- | ------------- | --------------------------------------------------- | ----------------------------------- | -------------- |
| `openai/gpt-6.1-terra` | GPT-6.1 Terra | Visual reasoning, computer use, and natural writing | none, low, medium, high, xhigh, max | medium         |
| `openai/gpt-6.2-astra` | GPT-6.2 Astra | Most capable model for your hardest projects        | low, medium, high, xhigh, max       | medium         |
| `openai/gpt-6.2-sol`   | GPT-6.2 Sol   | Efficient everyday model for coding and agents      | low, medium, high, xhigh, max       | medium         |
| `openai/gpt-6-luna`    | GPT-6 Luna    | Efficient model for focused, high-volume tasks      | none, low, medium, high, xhigh, max | medium         |

## xAI / SuperGrok

Grok models support connected SuperGrok provider accounts or `XAI_API_KEY` mode and are disabled by
default. See [Using Grok with a SuperGrok Subscription](GROK_MODELS.md) for setup and rollout
instructions.

| Model ID             | Display name   | Description                                     | Reasoning efforts        | Default effort |
| -------------------- | -------------- | ----------------------------------------------- | ------------------------ | -------------- |
| `xai/grok-4.7`       | Grok 4.7       | Latest Grok for chat, coding, and agentic tools | low, medium, high, xhigh | high           |
| `xai/grok-build-0.1` | Grok Build 0.1 | Coding model for SuperGrok subscribers          | Not supported            | N/A            |

## OpenCode Zen

OpenCode Zen models require `OPENCODE_API_KEY` as a global or repository secret. Zen is
pay-per-token against `https://opencode.ai/zen/v1`.

Reasoning efforts on Zen and Go models are the effort levels the models.dev catalog lists for each
model. A model the catalog marks only as reasoning on or off, such as LongCat 2.0, has none. Most
have no default effort, so the gateway's own default applies unless the session has one. That
includes an effort carried over from an earlier message, a saved Slack preference or a parent
session, which is sent whenever the new model supports that level. The Gemini models default to
high, the thinking level OpenCode already sends for them when none is chosen.

| Model ID                                   | Display name                    | Description     | Reasoning efforts | Default effort |
| ------------------------------------------ | ------------------------------- | --------------- | ----------------- | -------------- |
| `opencode/kimi-k3`                         | Kimi K3                         | Moonshot AI     | low, high, max    | Not set        |
| `opencode/minimax-m2.5`                    | MiniMax M2.5                    | MiniMax         | Not supported     | N/A            |
| `opencode/glm-5.2`                         | GLM 5.2                         | Z.ai            | high, max         | Not set        |
| `opencode/gemini-4-carbon`                 | Gemini 4 Carbon                 | Google          | low, medium, high | high           |
| `opencode/gemini-4-argon`                  | Gemini 4 Argon                  | Google          | low, medium, high | high           |
| `opencode/gemini-3.8-flash`                | Gemini 3.8 Flash                | Google          | low, medium, high | high           |
| `opencode/muse-spark-1.3-contributor-free` | Muse Spark 1.3 Contributor Free | Meta            | Not supported     | N/A            |
| `opencode/big-pickle`                      | Big Pickle                      | Reasoning model | Not supported     | N/A            |

## OpenCode Go

[OpenCode Go](https://opencode.ai/docs/go/) is a flat-rate subscription. It requires
`OPENCODE_GO_API_KEY` as a global, environment, or repository secret, separate from Zen's
`OPENCODE_API_KEY`. The key must carry an active Go subscription. Go routes to a separate gateway
(`https://opencode.ai/zen/go/v1`) and bills against the subscription's rolling usage allowance
instead of per token.

Usage is capped on three rolling windows — 20% of the monthly allowance per 5 hours, 50% per week,
100% per month. Allowances differ per model, so an unattended session pinned to a Go model can
exhaust its window and fail mid-run; keep Go models off unattended Slack, GitHub, Linear, and
automation launches unless you accept that.

The catalog mirrors the model list Go publishes under
[Endpoints](https://opencode.ai/docs/go/#endpoints), in the same order, with one exception: Go
documents `minimax-m2.5`, but the OpenCode release pinned in
`packages/sandbox-images/toolchain.json` does not resolve `opencode-go/minimax-m2.5`
(`opencode models` does not list it), so it is left out rather than offered as a selection that
fails. That model is reachable as `opencode/minimax-m2.5` on Zen.

| Model ID                                   | Display name                 | Description                   | Reasoning efforts                   | Default effort |
| ------------------------------------------ | ---------------------------- | ----------------------------- | ----------------------------------- | -------------- |
| `opencode-go/grok-4.6`                     | Grok 4.6                     | xAI                           | Not supported                       | N/A            |
| `opencode-go/gpt-5.6-luna`                 | GPT 5.6 Luna                 | OpenAI                        | none, low, medium, high, xhigh, max | Not set        |
| `opencode-go/gemini-4-argon`               | Gemini 4 Argon               | Google                        | low, medium, high                   | high           |
| `opencode-go/glm-5.3-flash`                | GLM 5.3 Flash                | Z.ai                          | low, high, max                      | high           |
| `opencode-go/glm-5.3`                      | GLM 5.3                      | Z.ai                          | low, high, max                      | Not set        |
| `opencode-go/glm-5.2`                      | GLM 5.2                      | Z.ai                          | high, max                           | Not set        |
| `opencode-go/kimi-k3`                      | Kimi K3                      | Moonshot AI                   | max                                 | Not set        |
| `opencode-go/kimi-k2.7-code`               | Kimi K2.7 Code               | Moonshot AI                   | Not supported                       | N/A            |
| `opencode-go/longcat-2.0`                  | LongCat 2.0                  | Meituan                       | Not supported                       | N/A            |
| `opencode-go/deepseek-v4.1-flash`          | DeepSeek V4.1 Flash          | DeepSeek                      | low, high, max                      | high           |
| `opencode-go/deepseek-v4-pro`              | DeepSeek V4 Pro              | DeepSeek                      | high, max                           | Not set        |
| `opencode-go/deepseek-v4-flash-vision-exp` | DeepSeek V4 Flash Vision Exp | DeepSeek, experimental vision | Not supported                       | N/A            |
| `opencode-go/mimo-v2.5`                    | MiMo V2.5                    | Xiaomi                        | Not supported                       | N/A            |
| `opencode-go/mimo-v2.5-pro`                | MiMo V2.5 Pro                | Xiaomi                        | Not supported                       | N/A            |
| `opencode-go/minimax-m3`                   | MiniMax M3                   | MiniMax                       | Not supported                       | N/A            |
| `opencode-go/minimax-m2.7`                 | MiniMax M2.7                 | MiniMax                       | Not supported                       | N/A            |
| `opencode-go/muse-spark-1.3-contributor`   | Muse Spark 1.3 Contributor   | Multimodal contributor tier   | low, medium, high, xhigh            | xhigh          |
| `opencode-go/qwen3.8-max`                  | Qwen3.8 Max                  | Alibaba Cloud                 | low, medium, xhigh                  | Not set        |
| `opencode-go/qwen3.8-flash`                | Qwen3.8 Flash                | Alibaba Cloud                 | low, medium, xhigh                  | Not set        |
| `opencode-go/hy4-preview`                  | Hy4 Preview                  | Tencent Hunyuan               | none, high                          | Not set        |
| `opencode-go/hy3`                          | Hy3                          | Tencent Hunyuan               | none, low, high                     | Not set        |

Some of these models are reachable through more than one provider, billed against different
credentials. `opencode-go/glm-5.2`, `opencode/glm-5.2` and `zai-coding-plan/glm-5.2` are the same
GLM model behind three. Pick the entry whose billing you want.

These models run on the OpenCode harness only — the Claude Agent harness runs Anthropic models
exclusively.

## Kimi Coding Plan

Kimi Coding Plan models require a [Kimi Code membership API key](https://www.kimi.com/code/docs/en/)
in `KIMI_API_KEY` as a global or repository secret. They run on OpenCode's built-in
`kimi-code-plan-global` provider, which calls Kimi's overseas coding endpoint and uses the
membership plan's allowance, separate from Kimi models billed through OpenCode Go. Model and
context-window access depend on the plan: the Highspeed models need Pro or above (Allegretto or
above on legacy plans), and a plan without access returns 403. See Kimi's
[model requirements](https://www.kimi.com/code/docs/en/kimi-code/models.html). Prebuilt images from
before runtime generation 79 may not list these models; rebuild one if a Kimi session reports the
model as not found, then start a new session, because an existing session keeps its sandbox's model
list.

| Model ID                                          | Display name              | Description      | Reasoning efforts | Default effort |
| ------------------------------------------------- | ------------------------- | ---------------- | ----------------- | -------------- |
| `kimi-code-plan-global/k3.1-pro`                  | Kimi K3.1 Pro             | Kimi Coding Plan | Not supported     | N/A            |
| `kimi-code-plan-global/k3.1-pro-highspeed`        | Kimi K3.1 Pro Highspeed   | Kimi Coding Plan | Not supported     | N/A            |
| `kimi-code-plan-global/k3`                        | Kimi K3                   | Kimi Coding Plan | Not supported     | N/A            |
| `kimi-code-plan-global/k3-256k`                   | Kimi K3 256K              | Kimi Coding Plan | Not supported     | N/A            |
| `kimi-code-plan-global/kimi-for-coding`           | Kimi for Coding           | Kimi Coding Plan | Not supported     | N/A            |
| `kimi-code-plan-global/kimi-for-coding-highspeed` | Kimi for Coding Highspeed | Kimi Coding Plan | Not supported     | N/A            |

## Z.AI Coding Plan

Z.AI Coding Plan models require `ZHIPU_API_KEY` as a global or repository secret.

| Model ID                        | Display name  | Description      | Reasoning efforts | Default effort |
| ------------------------------- | ------------- | ---------------- | ----------------- | -------------- |
| `zai-coding-plan/glm-5.2`       | GLM 5.2       | Z.AI Coding Plan | Not supported     | N/A            |
| `zai-coding-plan/glm-5.3`       | GLM 5.3       | Z.AI Coding Plan | low, high, max    | high           |
| `zai-coding-plan/glm-5.3-flash` | GLM 5.3 Flash | Z.AI Coding Plan | low, high, max    | high           |

## DeepSeek

DeepSeek models require `DEEPSEEK_API_KEY` as a global or repository secret.

| Model ID                     | Display name      | Description  | Reasoning efforts | Default effort |
| ---------------------------- | ----------------- | ------------ | ----------------- | -------------- |
| `deepseek/deepseek-v4-flash` | DeepSeek V4 Flash | Fast model   | Not supported     | N/A            |
| `deepseek/deepseek-v4-pro`   | DeepSeek V4 Pro   | Most capable | Not supported     | N/A            |

## MiniMax Coding Plan

MiniMax Coding Plan requires `MINIMAX_API_KEY` as a global, environment, or repository secret.

| Model ID                           | Display name | Description         | Reasoning efforts | Default effort |
| ---------------------------------- | ------------ | ------------------- | ----------------- | -------------- |
| `minimax-coding-plan/MiniMax-M2.7` | MiniMax M2.7 | MiniMax Coding Plan | Not supported     | N/A            |

## Fireworks AI

Fireworks AI requires `FIREWORKS_API_KEY` as a global, environment, or repository secret.

| Model ID                       | Display name    | Description  | Reasoning efforts | Default effort |
| ------------------------------ | --------------- | ------------ | ----------------- | -------------- |
| `fireworks-ai/kimi-k2p5-turbo` | Kimi K2.5 Turbo | Fireworks AI | Not supported     | N/A            |

## Ollama Cloud

Ollama Cloud requires `OLLAMA_CLOUD_API_KEY` as a global, environment, or repository secret.

| Model ID                    | Display name | Description | Reasoning efforts | Default effort |
| --------------------------- | ------------ | ----------- | ----------------- | -------------- |
| `ollama-cloud/glm-5.1`      | GLM 5.1      | Z.ai        | Not supported     | N/A            |
| `ollama-cloud/kimi-k2.5`    | Kimi K2.5    | Moonshot AI | Not supported     | N/A            |
| `ollama-cloud/minimax-m2.7` | MiniMax M2.7 | MiniMax     | Not supported     | N/A            |
