# =============================================================================
# Modal Sandbox Infrastructure
# =============================================================================

locals {
  modal_source_files = sort(concat(
    [for file in fileset("${var.project_root}/packages/modal-infra/src", "**/*.py") : "${var.project_root}/packages/modal-infra/src/${file}"],
    [for file in fileset("${var.project_root}/packages/modal-infra/src", "**/*.js") : "${var.project_root}/packages/modal-infra/src/${file}"],
    [for file in fileset("${var.project_root}/packages/modal-infra/src", "**/*.ts") : "${var.project_root}/packages/modal-infra/src/${file}"],
    [for file in fileset("${var.project_root}/packages/sandbox-runtime/src", "**/*.py") : "${var.project_root}/packages/sandbox-runtime/src/${file}"],
    [for file in fileset("${var.project_root}/packages/sandbox-runtime/src", "**/*.js") : "${var.project_root}/packages/sandbox-runtime/src/${file}"],
    [for file in fileset("${var.project_root}/packages/sandbox-runtime/src", "**/*.ts") : "${var.project_root}/packages/sandbox-runtime/src/${file}"],
  ))

  # Include both relative path and per-file hash so renames and content changes trigger redeploys.
  modal_source_hash = sha256(join("\n", [
    for file in local.modal_source_files :
    "${trimprefix(file, "${var.project_root}/")}:${filesha256(file)}"
  ]))
}

module "modal_app" {
  count  = local.use_modal_backend ? 1 : 0
  source = "../../modules/modal-app"

  modal_token_id     = var.modal_token_id
  modal_token_secret = var.modal_token_secret

  app_name      = "open-inspect"
  workspace     = var.modal_workspace
  deploy_path   = "${var.project_root}/packages/modal-infra"
  deploy_module = "deploy"
  source_hash   = local.modal_source_hash

  secrets = [
    {
      name = "llm-api-keys"
      values = {
        ANTHROPIC_API_KEY = var.anthropic_api_key
      }
    },
    {
      name = "github-app"
      values = {
        GITHUB_APP_ID              = var.github_app_id
        GITHUB_APP_PRIVATE_KEY     = var.github_app_private_key
        GITHUB_APP_INSTALLATION_ID = var.github_app_installation_id
      }
    },
    {
      name = "internal-api"
      values = {
        MODAL_API_SECRET            = var.modal_api_secret
        INTERNAL_CALLBACK_SECRET    = var.internal_callback_secret
        ALLOWED_CONTROL_PLANE_HOSTS = local.control_plane_host
        CONTROL_PLANE_URL           = local.control_plane_url
      }
    }
  ]
}
