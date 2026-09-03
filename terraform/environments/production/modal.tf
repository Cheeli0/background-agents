# =============================================================================
# Modal Sandbox Infrastructure
# =============================================================================

# Calculate the Modal source hash with Terraform functions so the deployment
# path works on Windows, macOS, and Linux without shell-specific utilities.
locals {
  modal_source_files = concat(
    [for file in fileset("${var.project_root}/packages/modal-infra/src", "**") : "${var.project_root}/packages/modal-infra/src/${file}"],
    [for file in fileset("${var.project_root}/packages/sandbox-runtime/src", "**") : "${var.project_root}/packages/sandbox-runtime/src/${file}"],
    [
      "${var.project_root}/packages/modal-infra/deploy.py",
      "${var.project_root}/packages/modal-infra/pyproject.toml",
      "${var.project_root}/packages/modal-infra/uv.lock",
      "${var.project_root}/terraform/modules/modal-app/scripts/modal-helper.mjs",
    ]
  )
  modal_source_hash = sha256(join("", [
    for file in sort(local.modal_source_files) : "${file}:${filesha256(file)}"
  ]))
}

module "modal_app" {
  count  = local.use_modal_backend ? 1 : 0
  source = "../../modules/modal-app"

  modal_token_id     = var.modal_token_id
  modal_token_secret = var.modal_token_secret

  app_name                     = "open-inspect"
  workspace                    = var.modal_workspace
  modal_environment            = var.modal_environment
  modal_environment_web_suffix = var.modal_environment_web_suffix
  deploy_path                  = "${var.project_root}/packages/modal-infra"
  deploy_module                = "deploy"
  source_hash                  = local.modal_source_hash

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
        ALLOWED_CONTROL_PLANE_HOSTS = local.control_plane_host
      }
    }
  ]
}
