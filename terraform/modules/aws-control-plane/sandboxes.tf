locals {
  ec2_sandboxes_enabled = var.ec2_sandboxes != null
  ec2_sandbox_subnet_cidr = !local.ec2_sandboxes_enabled ? null : (
    var.ec2_sandboxes.subnet_cidr != null ? var.ec2_sandboxes.subnet_cidr : cidrsubnet(var.vpc_cidr, 8, 2)
  )
  # The provider tags instances with DEPLOYMENT_NAME, which var.config may override.
  ec2_sandbox_deployment_name = local.env_config["DEPLOYMENT_NAME"]
  ec2_sandbox_ami_id          = local.ec2_sandboxes_enabled ? var.ec2_sandboxes.ami_id : null
  ec2_sandbox_active          = local.ec2_sandbox_ami_id != null

  # Must equal EC2_DEPLOYMENT_TAG (control-plane src/sandbox/providers/ec2-provider.ts).
  ec2_sandbox_deployment_tag = "openinspect:deployment"

  ec2_sandbox_config = local.ec2_sandbox_active ? merge(
    {
      SANDBOX_PROVIDER                       = "ec2"
      EC2_SANDBOX_REGION                     = data.aws_region.current.region
      EC2_SANDBOX_AMI_ID                     = local.ec2_sandbox_ami_id
      EC2_SANDBOX_SUBNET_ID                  = aws_subnet.sandboxes[0].id
      EC2_SANDBOX_SECURITY_GROUP_ID          = aws_security_group.sandboxes[0].id
      EC2_SANDBOX_INSTANCE_PROFILE_ARN       = aws_iam_instance_profile.sandbox[0].arn
      EC2_SANDBOX_CONTROL_PLANE_PRIVATE_HOST = aws_eip.this.public_dns
    },
    var.ec2_sandboxes.instance_type == null ? {} : {
      EC2_SANDBOX_INSTANCE_TYPE = var.ec2_sandboxes.instance_type
    },
  ) : {}
}

resource "aws_subnet" "sandboxes" {
  count = local.ec2_sandboxes_enabled ? 1 : 0

  vpc_id                  = aws_vpc.this.id
  cidr_block              = local.ec2_sandbox_subnet_cidr
  availability_zone       = local.az
  map_public_ip_on_launch = true

  tags = merge(local.tags, { Name = "${var.name}-sandboxes" })

  lifecycle {
    precondition {
      condition     = local.ec2_sandbox_subnet_cidr != var.subnet_cidr
      error_message = "The sandbox subnet must differ from subnet_cidr; set ec2_sandboxes.subnet_cidr."
    }
  }
}

resource "aws_route_table_association" "sandboxes" {
  count = local.ec2_sandboxes_enabled ? 1 : 0

  subnet_id      = aws_subnet.sandboxes[0].id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "sandboxes" {
  count = local.ec2_sandboxes_enabled ? 1 : 0

  name_prefix = "${var.name}-sandboxes-"
  description = "Open-Inspect EC2 sandboxes: nothing in, everything out"
  vpc_id      = aws_vpc.this.id

  tags = merge(local.tags, { Name = "${var.name}-sandboxes" })

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_egress_rule" "sandboxes" {
  count = local.ec2_sandboxes_enabled ? 1 : 0

  security_group_id = aws_security_group.sandboxes[0].id
  description       = "All outbound"
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_vpc_security_group_ingress_rule" "https_from_sandboxes" {
  count = local.ec2_sandboxes_enabled ? 1 : 0

  security_group_id            = aws_security_group.instance.id
  description                  = "HTTPS from EC2 sandboxes"
  referenced_security_group_id = aws_security_group.sandboxes[0].id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}

resource "aws_iam_role" "sandbox" {
  count = local.ec2_sandboxes_enabled ? 1 : 0

  name               = "${var.name}-sandbox"
  assume_role_policy = data.aws_iam_policy_document.ec2_assume.json
  tags               = local.tags
}

resource "aws_iam_instance_profile" "sandbox" {
  count = local.ec2_sandboxes_enabled ? 1 : 0

  name = "${var.name}-sandbox"
  role = aws_iam_role.sandbox[0].name
  tags = local.tags
}

data "aws_iam_policy_document" "sandbox_launcher" {
  count = local.ec2_sandbox_active ? 1 : 0

  statement {
    sid       = "LaunchFromApprovedImage"
    actions   = ["ec2:RunInstances"]
    resources = ["arn:aws:ec2:${data.aws_region.current.region}::image/${local.ec2_sandbox_ami_id}"]
  }

  statement {
    sid     = "LaunchIntoSandboxNetwork"
    actions = ["ec2:RunInstances"]
    resources = [
      aws_subnet.sandboxes[0].arn,
      aws_security_group.sandboxes[0].arn,
    ]
  }

  statement {
    sid       = "LaunchSandboxInterfaces"
    actions   = ["ec2:RunInstances"]
    resources = ["arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:network-interface/*"]
    condition {
      test     = "ArnEquals"
      variable = "ec2:Subnet"
      values   = [aws_subnet.sandboxes[0].arn]
    }
  }

  statement {
    sid     = "LaunchTaggedSandboxes"
    actions = ["ec2:RunInstances"]
    resources = [
      "arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:instance/*",
      "arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:volume/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "aws:RequestTag/${local.ec2_sandbox_deployment_tag}"
      values   = [local.ec2_sandbox_deployment_name]
    }
  }

  statement {
    sid     = "TagAtLaunch"
    actions = ["ec2:CreateTags"]
    resources = [
      "arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:instance/*",
      "arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:volume/*",
    ]
    condition {
      test     = "StringEquals"
      variable = "ec2:CreateAction"
      values   = ["RunInstances"]
    }
  }

  statement {
    sid       = "ControlOwnSandboxes"
    actions   = ["ec2:StartInstances", "ec2:StopInstances", "ec2:TerminateInstances"]
    resources = ["arn:aws:ec2:${data.aws_region.current.region}:${data.aws_caller_identity.current.account_id}:instance/*"]
    condition {
      test     = "StringEquals"
      variable = "ec2:ResourceTag/${local.ec2_sandbox_deployment_tag}"
      values   = [local.ec2_sandbox_deployment_name]
    }
  }

  # EC2 authorizes Describe calls against "*" only.
  statement {
    sid       = "DescribeInstances"
    actions   = ["ec2:DescribeInstances"]
    resources = ["*"]
  }

  statement {
    sid       = "PassSandboxRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.sandbox[0].arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ec2.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "sandbox_launcher" {
  count = local.ec2_sandbox_active ? 1 : 0

  name   = "${var.name}-sandbox-launcher"
  role   = aws_iam_role.instance.id
  policy = data.aws_iam_policy_document.sandbox_launcher[0].json
}
