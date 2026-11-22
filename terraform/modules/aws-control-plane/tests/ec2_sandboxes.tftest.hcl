mock_provider "aws" {}
mock_provider "cloudinit" {}

variables {
  name     = "open-inspect-test"
  hostname = "control-plane.example.com"
}

override_data {
  target = data.aws_ec2_instance_type.this
  values = { supported_architectures = ["arm64"] }
}

override_data {
  target = data.aws_availability_zones.available
  values = { names = ["us-west-2a", "us-west-2b"] }
}

override_data {
  target = data.aws_region.current
  values = { region = "us-west-2" }
}

override_data {
  target = data.aws_iam_policy_document.ec2_assume
  values = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Principal\":{\"Service\":\"ec2.amazonaws.com\"}}]}" }
}

override_data {
  target = data.aws_iam_policy_document.dlm_assume
  values = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Principal\":{\"Service\":\"ec2.amazonaws.com\"}}]}" }
}

override_data {
  target = data.aws_iam_policy_document.instance
  values = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"s3:GetObject\",\"Resource\":\"*\"}]}" }
}

override_data {
  target = data.aws_iam_policy_document.sandbox_launcher
  values = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":\"ec2:DescribeInstances\",\"Resource\":\"*\"}]}" }
}

run "off_by_default" {
  command = plan

  assert {
    condition     = length(aws_subnet.sandboxes) == 0 && length(aws_iam_role_policy.sandbox_launcher) == 0
    error_message = "No sandbox resources are created unless ec2_sandboxes is set"
  }
}

run "network_before_an_ami" {
  command = plan

  variables {
    ec2_sandboxes = {}
  }

  assert {
    condition     = length(aws_subnet.sandboxes) == 1
    error_message = "The sandbox subnet exists so the AMI can be built in it"
  }

  assert {
    condition     = length(aws_iam_role_policy.sandbox_launcher) == 0
    error_message = "The control plane gets no EC2 grant until an AMI is named"
  }

  assert {
    condition     = !contains(keys(aws_ssm_parameter.config), "SANDBOX_PROVIDER")
    error_message = "The deployment does not switch provider before an AMI exists"
  }
}

run "switches_to_ec2_once_an_ami_is_named" {
  command = plan

  variables {
    ec2_sandboxes = { ami_id = "ami-0123456789abcdef0" }
  }

  assert {
    condition     = aws_ssm_parameter.config["SANDBOX_PROVIDER"].value == "ec2"
    error_message = "Naming an AMI selects the ec2 provider"
  }

  assert {
    condition     = length(aws_iam_role_policy.sandbox_launcher) == 1
    error_message = "The control plane is granted its EC2 calls"
  }
}

run "config_still_wins" {
  command = plan

  variables {
    ec2_sandboxes = { ami_id = "ami-0123456789abcdef0" }
    config        = { SANDBOX_PROVIDER = "modal" }
  }

  assert {
    condition     = aws_ssm_parameter.config["SANDBOX_PROVIDER"].value == "modal"
    error_message = "An operator's var.config entry overrides the derived provider"
  }
}

run "rejects_a_sandbox_subnet_that_collides_with_the_control_plane_subnet" {
  command = plan

  variables {
    ec2_sandboxes = { subnet_cidr = "10.20.1.0/24" }
  }

  expect_failures = [aws_subnet.sandboxes]
}

run "a_sandbox_subnet_override_works_in_a_small_vpc" {
  command = plan

  variables {
    vpc_cidr      = "10.20.0.0/25"
    subnet_cidr   = "10.20.0.0/26"
    ec2_sandboxes = { subnet_cidr = "10.20.0.64/26" }
  }

  assert {
    condition     = aws_subnet.sandboxes[0].cidr_block == "10.20.0.64/26"
    error_message = "An explicit sandbox subnet is used without deriving the default"
  }
}

run "rejects_a_malformed_ami_id" {
  command = plan

  variables {
    ec2_sandboxes = { ami_id = "ubuntu-24.04" }
  }

  expect_failures = [var.ec2_sandboxes]
}
