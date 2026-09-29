# =============================================================================
# Modal Sandbox Infrastructure
# =============================================================================

# Use the shared image planner for the image hash. The Node wrapper selects a
# working uv executable on Windows, macOS, and Linux without invoking a shell.
data "external" "modal_image_hash" {
  count = local.use_modal_backend ? 1 : 0

  program = ["node", "${var.project_root}/terraform/modules/modal-app/scripts/modal-helper.mjs", "image-hash", var.project_root, "modal"]
}

locals {
  modal_source_hash = local.use_modal_backend ? sha256(join(":", [
    data.external.modal_image_hash[0].result.hash,
    filesha256("${var.project_root}/packages/modal-infra/deploy.py"),
    filesha256("${var.project_root}/terraform/modules/modal-app/scripts/modal-helper.mjs"),
  ])) : ""
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
      name   = "llm-api-keys"
      values = local.modal_llm_secret_values
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
