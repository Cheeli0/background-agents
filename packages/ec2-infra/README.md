# EC2 sandbox image

Builds the base AMI the `ec2` sandbox provider launches session instances from, and holds what that
AMI runs at boot. The provider and its setup are described in
[docs/EC2_SANDBOX_PROVIDER.md](../../docs/EC2_SANDBOX_PROVIDER.md).

| File                          | Installed at                                      | Role                                                                                      |
| ----------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `build-ami.py`                | (build host)                                      | Builds and verifies the AMI; run through `npm run sandbox:images -- build --provider ec2` |
| `launcher.sh`                 | `/opt/openinspect/ec2/launcher.sh`                | Redeems the bootstrap, arms the lifetime backstop, starts the runtime                     |
| `exec-runtime.py`             | `/opt/openinspect/ec2/exec-runtime.py`            | Validates the session environment and execs the runtime as `user` without exposing it     |
| `image_scripts.py`            | (build host)                                      | The user data `build-ami.py` gives its build and verification instances                   |
| `openinspect-sandbox.service` | `/etc/systemd/system/openinspect-sandbox.service` | Runs the launcher on every boot of a session instance                                     |

## Build

```bash
export AWS_REGION=us-west-2
export EC2_SANDBOX_SUBNET_ID=subnet-...          # outbound internet access
export EC2_SANDBOX_SECURITY_GROUP_ID=sg-...      # outbound internet access
export EC2_IMAGE_BUILD_BUCKET=my-bucket          # the bundle is staged here briefly
npm run sandbox:images -- build --provider ec2 --output /tmp/ec2-image.json
```

The `aws-control-plane` Terraform module outputs all four as `ec2_sandbox_image_build_env`.

The credentials need `ec2:RunInstances`, `ec2:DescribeInstances`, `ec2:GetConsoleOutput`,
`ec2:CreateImage`, `ec2:DescribeImages`, `ec2:CreateTags`, `ec2:TerminateInstances`,
`ssm:GetParameter` on Canonical's public Ubuntu parameter, and `s3:PutObject`, `s3:GetObject` and
`s3:DeleteObject` on the bucket.

The AMI is named `openinspect-sandbox-<16 hex build hash>`. A build whose name already exists
re-verifies that AMI instead of building again.

## Boot sequence

1. The provider's user data writes `/etc/openinspect/bootstrap` (the redeem URL and a single-use
   token) and starts `openinspect-sandbox.service`. It can also write
   `/etc/openinspect/control-plane-route`: the control plane's hostname and a private DNS name for
   it, which the launcher resolves on every boot into a tagged `/etc/hosts` entry.
2. `launcher.sh` redeems the token and keeps the environment at `/etc/openinspect/session.json`
   (root only). A refused token, or a control plane unreachable for `OI_BOOTSTRAP_WAIT_SECONDS`,
   powers the instance off, which terminates it.
3. The launcher arms a power-off at the session lifetime plus `OI_LIFETIME_GRACE_SECONDS` and starts
   the runtime as `user`, in restored mode when an earlier boot on this disk completed.
4. After a stop and start, the service runs again from the kept environment; no new token is needed.
