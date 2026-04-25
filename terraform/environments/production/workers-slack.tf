# =============================================================================
# Slack Bot Worker
# =============================================================================

# Build slack-bot worker bundle during plan so cloudflare_worker_version reads
# stable module content during apply.
data "external" "slack_bot_build" {
  count = var.enable_slack_bot ? 1 : 0

  program = ["bash", "-c", <<-EOF
    cd ${var.project_root}
    npm run build -w @open-inspect/shared >&2
    npm run build -w @open-inspect/slack-bot >&2
    if command -v sha256sum >/dev/null 2>&1; then
      hash=$(sha256sum packages/slack-bot/dist/index.js | cut -d' ' -f1)
    else
      hash=$(shasum -a 256 packages/slack-bot/dist/index.js | cut -d' ' -f1)
    fi
    echo "{\"hash\": \"$hash\"}"
  EOF
  ]
}

module "slack_bot_worker" {
  count  = var.enable_slack_bot ? 1 : 0
  source = "../../modules/cloudflare-worker"

  account_id  = var.cloudflare_account_id
  worker_name = "open-inspect-slack-bot-${local.name_suffix}"
  script_path = local.slack_bot_script_path

  kv_namespaces = [
    {
      binding_name = "SLACK_KV"
      namespace_id = module.slack_kv[0].namespace_id
    }
  ]

  service_bindings = [
    {
      binding_name = "CONTROL_PLANE"
      service_name = "open-inspect-control-plane-${local.name_suffix}"
    }
  ]

  enable_service_bindings = var.enable_service_bindings

  plain_text_bindings = [
    { name = "CONTROL_PLANE_URL", value = local.control_plane_url },
    { name = "WEB_APP_URL", value = local.web_app_url },
    { name = "DEPLOYMENT_NAME", value = var.deployment_name },
    { name = "DEFAULT_MODEL", value = "claude-haiku-4-5" },
    { name = "CLASSIFICATION_MODEL", value = "claude-haiku-4-5" },
  ]

  secrets = [
    { name = "SLACK_BOT_TOKEN", value = var.slack_bot_token },
    { name = "SLACK_SIGNING_SECRET", value = var.slack_signing_secret },
    { name = "ANTHROPIC_API_KEY", value = var.anthropic_api_key },
    { name = "INTERNAL_CALLBACK_SECRET", value = var.internal_callback_secret },
  ]

  compatibility_date  = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  depends_on = [data.external.slack_bot_build[0], module.slack_kv[0]]
}
