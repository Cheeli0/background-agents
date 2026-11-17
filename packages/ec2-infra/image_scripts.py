"""User data for the AMI builder's instances; kept free of the AWS SDK so tests load it."""

from __future__ import annotations

import shlex

OK_MARKER = "OPENINSPECT_IMAGE_STEP_OK"
FAILED_MARKER = "OPENINSPECT_IMAGE_STEP_FAILED"

EC2_FILES = {
    "launcher.sh": ("/opt/openinspect/ec2/launcher.sh", "0755"),
    "exec-runtime.py": ("/opt/openinspect/ec2/exec-runtime.py", "0755"),
    "openinspect-sandbox.service": ("/etc/systemd/system/openinspect-sandbox.service", "0644"),
}

# The serial console is the only output build-ami.py reads.
SCRIPT_PRELUDE = f"""#!/bin/bash
set -Eeuo pipefail
exec > >(tee /var/log/openinspect-image.log >/dev/console) 2>&1
fail() {{
  echo "{FAILED_MARKER}: line $1"
  sync
  systemctl poweroff
}}
trap 'fail $LINENO' ERR
export DEBIAN_FRONTEND=noninteractive
"""


def build_script(bundle_url: str) -> str:
    install = "\n".join(
        f"install -D -m {mode} /tmp/openinspect-image/ec2/{name} {path}"
        for name, (path, mode) in EC2_FILES.items()
    )
    return (
        SCRIPT_PRELUDE
        + f"""
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl sudo
curl --fail --silent --show-error --location --retry 3 \\
  --output /tmp/openinspect-image.tar.gz {shlex.quote(bundle_url)}
mkdir -p /tmp/openinspect-image
tar -xzf /tmp/openinspect-image.tar.gz -C /tmp/openinspect-image
bash /tmp/openinspect-image/packages/sandbox-images/install/install.sh
{install}
printf '%s\\n' 'user ALL=(ALL) NOPASSWD:ALL' >/etc/sudoers.d/90-openinspect-user
chmod 0440 /etc/sudoers.d/90-openinspect-user
systemctl daemon-reload
systemctl enable openinspect-sandbox.service
rm -rf /tmp/openinspect-image /tmp/openinspect-image.tar.gz
cloud-init clean --logs
rm -f /etc/ssh/ssh_host_*
truncate -s 0 /etc/machine-id
echo "{OK_MARKER}"
sync
systemctl poweroff
"""
    )


def verify_script(runtime_env: dict[str, str]) -> str:
    assignments = " ".join(shlex.quote(f"{key}={value}") for key, value in runtime_env.items())
    return (
        SCRIPT_PRELUDE
        + f"""
test -x /opt/openinspect/ec2/launcher.sh
systemctl is-enabled openinspect-sandbox.service
env {assignments} /opt/openinspect/python/bin/python /app/verify/smoke_test.py verify
echo "{OK_MARKER}"
sync
systemctl poweroff
"""
    )
