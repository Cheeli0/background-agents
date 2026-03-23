# Using GitHub Copilot Models

Open-Inspect can use GitHub Copilot-backed models through OpenCode in addition to the existing
direct Anthropic and OpenAI paths.

## Supported Model IDs

This repo currently exposes a conservative static subset:

- `github-copilot/gpt-4.1`
- `github-copilot/gpt-5`
- `github-copilot/gpt-5-mini`
- `github-copilot/claude-sonnet-4`

These are billed and authorized through your GitHub Copilot subscription, not through direct
OpenAI or Anthropic credentials.

## Setup

1. Install OpenCode locally and authenticate with GitHub Copilot:
   ```bash
   opencode
   ```
2. Inside OpenCode, run `/connect` and choose `GitHub Copilot`.
3. Complete the device login flow at `https://github.com/login/device`.
4. Run `/models` to confirm which `github-copilot/*` models your account exposes.
5. Open the auth file:
   ```bash
   cat ~/.local/share/opencode/auth.json
   ```
6. Copy the minimal JSON object that includes your GitHub Copilot provider credentials.
7. Add that JSON as the `OPENCODE_AUTH_JSON` secret in Open-Inspect settings.

`OPENCODE_AUTH_JSON` can be stored as either a repository secret or a global secret.

## Expected Secret Structure

Preferred format:

```json
{
  "github-copilot": {
    "type": "oauth",
    "access": "...",
    "refresh": "...",
    "expires": 0
  }
}
```

Also accepted:

Full auth object using `copilot`:

```json
{
  "copilot": {
    "type": "oauth",
    "access": "...",
    "refresh": "...",
    "expires": 0
  }
}
```

Direct provider entry pasted by itself:

```json
{
  "type": "oauth",
  "access": "...",
  "refresh": "...",
  "expires": 0
}
```

The wrapped `github-copilot` form is preferred because it matches the provider naming used by the
Open-Inspect model registry.

## Notes

- Some Copilot models require higher-tier GitHub Copilot plans.
- Enterprise or organization policy can restrict which models are available.
- The GitHub Copilot model catalog changes over time, so `/models` is the source of truth for your
  account.

## Troubleshooting

### Session creation fails with missing credentials

Set `OPENCODE_AUTH_JSON` in Open-Inspect settings. The value must be a JSON object. The preferred
shape is an object containing a `github-copilot` entry, but the backend also accepts a `copilot`
entry or the provider entry pasted directly.

### A model is missing from the dropdown

Copilot-backed models are opt-in. Enable them in model settings after adding the auth secret.

### A model appears but requests fail

Your GitHub Copilot plan or organization policy may not allow that model even if it exists in the
shared registry. Re-run `/models` locally and compare it with the model you selected in
Open-Inspect.
