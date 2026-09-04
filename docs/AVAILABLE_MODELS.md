# Available Models

Open-Inspect exposes these models in the model picker and integration preferences. The default
enabled set includes Anthropic and OpenAI models. Every other provider is opt-in under **Settings >
Models**. OpenAI and SuperGrok subscriptions are configured in **Settings > Provider Accounts**.
API-key providers require the matching global, environment, or repository secret described below.

OpenAI and xAI session selectors offer provider policy, any active connected account, and API-key
mode. Automation editors can resolve defaults on each run or pin an account/API-key choice.
Unattended Slack, GitHub, Linear, and unpinned automation launches follow the provider's configured
unattended mode.

## Anthropic

| Model ID                      | Display name      | Description                        | Reasoning efforts             | Default effort |
| ----------------------------- | ----------------- | ---------------------------------- | ----------------------------- | -------------- |
| `anthropic/claude-haiku-4-5`  | Claude Haiku 4.5  | Fast and efficient                 | high, max                     | max            |
| `anthropic/claude-sonnet-4-5` | Claude Sonnet 4.5 | Balanced performance               | high, max                     | max            |
| `anthropic/claude-sonnet-4-6` | Claude Sonnet 4.6 | Balanced, fast coding              | low, medium, high, max        | high           |
| `anthropic/claude-sonnet-5`   | Claude Sonnet 5   | Latest Sonnet, adaptive thinking   | low, medium, high, xhigh, max | high           |
| `anthropic/claude-opus-4-5`   | Claude Opus 4.5   | Most capable                       | high, max                     | max            |
| `anthropic/claude-opus-4-6`   | Claude Opus 4.6   | Most capable, adaptive thinking    | low, medium, high, max        | high           |
| `anthropic/claude-opus-4-7`   | Claude Opus 4.7   | Most capable, adaptive thinking    | low, medium, high, xhigh, max | high           |
| `anthropic/claude-opus-4-8`   | Claude Opus 4.8   | Most capable, adaptive thinking    | low, medium, high, xhigh, max | high           |
| `anthropic/claude-opus-5`     | Claude Opus 5     | Latest Opus, adaptive thinking     | low, medium, high, xhigh, max | high           |
| `anthropic/claude-fable-5`    | Claude Fable 5    | Most powerful, new tier above Opus | low, medium, high, xhigh, max | high           |

## OpenAI

OpenAI models support connected ChatGPT provider accounts or `OPENAI_API_KEY` mode. See
[Using OpenAI Models](OPENAI_MODELS.md) for account setup and coexistence details.

| Model ID                     | Display name        | Description                                  | Reasoning efforts              | Default effort |
| ---------------------------- | ------------------- | -------------------------------------------- | ------------------------------ | -------------- |
| `openai/gpt-5.4`             | GPT 5.4             | Flagship model                               | none, low, medium, high, xhigh | Not set        |
| `openai/gpt-5.5`             | GPT 5.5             | Latest flagship model                        | none, low, medium, high, xhigh | Not set        |
| `openai/gpt-5.6-sol`         | GPT 5.6 Sol         | Frontier model for complex professional work | none, low, medium, high, xhigh | Not set        |
| `openai/gpt-5.6-terra`       | GPT 5.6 Terra       | Balanced, cost-efficient everyday work       | none, low, medium, high, xhigh | Not set        |
| `openai/gpt-5.6-luna`        | GPT 5.6 Luna        | Fast, cost-efficient high-volume workloads   | none, low, medium, high, xhigh | Not set        |
| `openai/gpt-5.3-codex`       | GPT 5.3 Codex       | Latest codex                                 | low, medium, high, xhigh       | high           |
| `openai/gpt-5.3-codex-spark` | GPT 5.3 Codex Spark | Low-latency codex variant                    | low, medium, high, xhigh       | high           |

## xAI / SuperGrok

Grok models support connected SuperGrok provider accounts or `XAI_API_KEY` mode and are disabled by
default. See [Using Grok with a SuperGrok Subscription](GROK_MODELS.md) for setup and rollout
instructions.

| Model ID             | Display name   | Description                                     | Reasoning efforts | Default effort |
| -------------------- | -------------- | ----------------------------------------------- | ----------------- | -------------- |
| `xai/grok-4.5`       | Grok 4.5       | Grok for chat, coding, and agentic tools        | low, medium, high | high           |
| `xai/grok-4.6`       | Grok 4.6       | Latest Grok for chat, coding, and agentic tools | low, medium, high | high           |
| `xai/grok-build-0.1` | Grok Build 0.1 | Coding model for SuperGrok subscribers          | Not configurable  | N/A            |

## OpenCode Zen

| Model ID                                   | Display name                    | Description     | Reasoning efforts                 | Default effort |
| ------------------------------------------ | ------------------------------- | --------------- | --------------------------------- | -------------- |
| `opencode/kimi-k2.5`                       | Kimi K2.5                       | Moonshot AI     | Not supported                     | N/A            |
| `opencode/kimi-k2.6`                       | Kimi K2.6                       | Moonshot AI     | Not supported                     | N/A            |
| `opencode/kimi-k3`                         | Kimi K3                         | Moonshot AI     | Not supported                     | N/A            |
| `opencode/minimax-m2.5`                    | MiniMax M2.5                    | MiniMax         | Not supported                     | N/A            |
| `opencode/qwen3.7-max`                     | Qwen3.7 Max                     | Alibaba Cloud   | Not supported                     | N/A            |
| `opencode/glm-5`                           | GLM 5                           | Z.ai 744B MoE   | Not supported                     | N/A            |
| `opencode/glm-5.1`                         | GLM 5.1                         | Z.ai            | Not supported                     | N/A            |
| `opencode/glm-5.2`                         | GLM 5.2                         | Z.ai            | Not supported                     | N/A            |
| `opencode/muse-spark-1.3-contributor-free` | Muse Spark 1.3 Contributor Free | Meta            | minimal, low, medium, high, xhigh | xhigh          |
| `opencode/big-pickle`                      | Big Pickle                      | Reasoning model | Not configurable                  | N/A            |

## Z.AI Coding Plan

Z.AI Coding Plan models require `ZHIPU_API_KEY` as a global or repository secret.

| Model ID                        | Display name  | Description      | Reasoning efforts | Default effort |
| ------------------------------- | ------------- | ---------------- | ----------------- | -------------- |
| `zai-coding-plan/glm-5.2`       | GLM 5.2       | Z.AI Coding Plan | Not supported     | N/A            |
| `zai-coding-plan/glm-5.3`       | GLM 5.3       | Z.AI Coding Plan | Not supported     | N/A            |
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

## OpenCode Go

OpenCode Go requires `OPENCODE_GO_API_KEY` as a global, environment, or repository secret.

| Model ID                                   | Display name                 | Description      | Reasoning efforts                 | Default effort |
| ------------------------------------------ | ---------------------------- | ---------------- | --------------------------------- | -------------- |
| `opencode-go/glm-5.1`                      | GLM 5.1                      | Z.ai             | Not supported                     | N/A            |
| `opencode-go/glm-5.3-flash`                | GLM 5.3 Flash                | Z.ai             | low, high, max                    | high           |
| `opencode-go/kimi-k2.5`                    | Kimi K2.5                    | Moonshot AI      | Not supported                     | N/A            |
| `opencode-go/kimi-k2.6`                    | Kimi K2.6                    | Moonshot AI      | Not supported                     | N/A            |
| `opencode-go/qwen3.6-plus`                 | Qwen3.6 Plus                 | Alibaba Cloud    | Not supported                     | N/A            |
| `opencode-go/minimax-m2.7`                 | MiniMax M2.7                 | MiniMax          | Not supported                     | N/A            |
| `opencode-go/mimo-v2-pro`                  | MiMo V2 Pro                  | Xiaomi           | Not supported                     | N/A            |
| `opencode-go/mimo-v2-omni`                 | MiMo V2 Omni                 | Xiaomi           | Not supported                     | N/A            |
| `opencode-go/muse-spark-1.3-contributor`   | Muse Spark 1.3 Contributor   | Meta             | minimal, low, medium, high, xhigh | xhigh          |
| `opencode-go/deepseek-v4-flash`            | DeepSeek V4 Flash            | DeepSeek         | low, high, max                    | high           |
| `opencode-go/deepseek-v4-flash-vision-exp` | DeepSeek V4 Flash Vision Exp | DeepSeek, vision | low, high, max                    | high           |

## Ollama Cloud

Ollama Cloud requires `OLLAMA_CLOUD_API_KEY` as a global, environment, or repository secret.

| Model ID                    | Display name | Description | Reasoning efforts | Default effort |
| --------------------------- | ------------ | ----------- | ----------------- | -------------- |
| `ollama-cloud/glm-5.1`      | GLM 5.1      | Z.ai        | Not supported     | N/A            |
| `ollama-cloud/kimi-k2.5`    | Kimi K2.5    | Moonshot AI | Not supported     | N/A            |
| `ollama-cloud/minimax-m2.7` | MiniMax M2.7 | MiniMax     | Not supported     | N/A            |
