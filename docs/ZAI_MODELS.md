# Using Z.AI Models

Open-Inspect supports Z.AI Coding Plan models through OpenCode. This guide covers the supported
models and the simplest setup path.

## Supported Models

- `zai-coding-plan/glm-5`
- `zai-coding-plan/glm-5-turbo`
- `zai-coding-plan/glm-4.7`
- `zai-coding-plan/glm-4.5-air`

These models are authorized with a Z.AI API key and run through OpenCode's Z.AI provider.

## Setup

### Step 1: Create a Z.AI API Key

1. Go to [Z.AI API Keys](https://z.ai/manage-apikey/apikey-list)
2. Create a new API key
3. Copy the key value

### Step 2: Add the Secret in Open-Inspect

Go to **Settings -> Secrets** and add either a repository secret or a global secret:

| Secret Name   | Value        |
| ------------- | ------------ |
| `ZAI_API_KEY` | Your API key |

This is the simplest setup. You only need the API key in the UI.

## Notes

- OpenCode uses the Z.AI provider ID `zai` and a dedicated Coding Plan provider ID
  `zai-coding-plan`.
- Z.AI Coding Plan requests use the coding endpoint rather than the general Z.AI API endpoint.
- You can enable or disable these models from the model settings page like any other provider.

## Troubleshooting

### Session creation fails with missing credentials

Add `ZAI_API_KEY` in Open-Inspect settings.

### Model does not appear in the dropdown

Enable the Z.AI models from **Settings -> Models** if they were previously disabled.
