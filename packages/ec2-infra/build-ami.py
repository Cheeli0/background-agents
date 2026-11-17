#!/usr/bin/env python3
"""Build and verify the EC2 sandbox base AMI; configuration and flow in README.md."""

from __future__ import annotations

import io
import os
import sys
import tarfile
import time
from pathlib import Path
from typing import Any

import boto3
from image_scripts import EC2_FILES, FAILED_MARKER, OK_MARKER, build_script, verify_script

ROOT = Path(__file__).resolve().parents[2]
INFRA = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "packages/sandbox-images/src"))

from sandbox_images.bundle import pack_bundle  # noqa: E402
from sandbox_images.native import write_build_result  # noqa: E402

UBUNTU_AMI_PARAMETER = (
    "/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id"
)
AMI_NAME_PREFIX = "openinspect-sandbox"
BUILD_HASH_NAME_CHARS = 16
BUILD_INSTANCE_TYPE = "m7i.large"
ROOT_DEVICE_NAME = "/dev/sda1"
ROOT_VOLUME_GIB = 64
BUILD_TAG = "openinspect:image-build"
BUNDLE_KEY_PREFIX = "openinspect-image-builds"

BUNDLE_URL_TTL_SECONDS = 2 * 60 * 60
POLL_INTERVAL_SECONDS = 15
BUILD_TIMEOUT_SECONDS = 60 * 60
VERIFY_TIMEOUT_SECONDS = 20 * 60
IMAGE_TIMEOUT_SECONDS = 45 * 60
CONSOLE_TAIL_CHARS = 4000


class ImageBuildError(RuntimeError):
    """An image build or verification step did not succeed."""


class Ec2ImageBuilder:
    def __init__(self, session: Any, subnet_id: str, security_group_id: str):
        self.ec2 = session.client("ec2")
        self.ssm = session.client("ssm")
        self.s3 = session.client("s3")
        self.subnet_id = subnet_id
        self.security_group_id = security_group_id

    def find_image(self, name: str) -> dict[str, Any] | None:
        images = self.ec2.describe_images(
            Owners=["self"], Filters=[{"Name": "name", "Values": [name]}]
        )["Images"]
        return images[0] if images else None

    def build_image(self, name: str, bucket: str, bundle_directory: Path, build_hash: str) -> str:
        base_image = self.ssm.get_parameter(Name=UBUNTU_AMI_PARAMETER)["Parameter"]["Value"]
        key = f"{BUNDLE_KEY_PREFIX}/{name}.tar.gz"
        self.s3.put_object(Bucket=bucket, Key=key, Body=build_archive(bundle_directory))
        try:
            url = self.s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": bucket, "Key": key},
                ExpiresIn=BUNDLE_URL_TTL_SECONDS,
            )
            instance_id = self.run_step(
                base_image, build_script(url), f"{name}-build", BUILD_TIMEOUT_SECONDS
            )
            try:
                return self.create_image(instance_id, name, build_hash)
            finally:
                self.terminate(instance_id)
        finally:
            self.s3.delete_object(Bucket=bucket, Key=key)

    def run_step(self, image_id: str, script: str, name: str, timeout_seconds: int) -> str:
        instance_id = self.ec2.run_instances(
            ImageId=image_id,
            InstanceType=BUILD_INSTANCE_TYPE,
            MinCount=1,
            MaxCount=1,
            SubnetId=self.subnet_id,
            SecurityGroupIds=[self.security_group_id],
            UserData=script,
            InstanceInitiatedShutdownBehavior="stop",
            MetadataOptions={"HttpTokens": "required", "HttpPutResponseHopLimit": 1},
            BlockDeviceMappings=[
                {
                    "DeviceName": ROOT_DEVICE_NAME,
                    "Ebs": {
                        "VolumeSize": ROOT_VOLUME_GIB,
                        "VolumeType": "gp3",
                        "Encrypted": True,
                        "DeleteOnTermination": True,
                    },
                }
            ],
            TagSpecifications=[
                {
                    "ResourceType": kind,
                    "Tags": [{"Key": "Name", "Value": name}, {"Key": BUILD_TAG, "Value": name}],
                }
                for kind in ("instance", "volume")
            ],
        )["Instances"][0]["InstanceId"]
        print(f"{name}: instance {instance_id}", file=sys.stderr)
        try:
            self.wait_for_marker(instance_id, timeout_seconds)
        except BaseException:
            self.terminate(instance_id)
            raise
        return instance_id

    def wait_for_marker(self, instance_id: str, timeout_seconds: int) -> None:
        deadline = time.monotonic() + timeout_seconds
        while time.monotonic() < deadline:
            time.sleep(POLL_INTERVAL_SECONDS)
            console = self.read_console(instance_id)
            if FAILED_MARKER in console:
                raise ImageBuildError(
                    f"Image step failed on {instance_id}:\n{console[-CONSOLE_TAIL_CHARS:]}"
                )
            state = self.ec2.describe_instances(InstanceIds=[instance_id])["Reservations"][0][
                "Instances"
            ][0]["State"]["Name"]
            if state == "stopped":
                if OK_MARKER in console:
                    return
                # EC2's console output can lag the power-off.
                time.sleep(POLL_INTERVAL_SECONDS)
                if OK_MARKER in self.read_console(instance_id):
                    return
                raise ImageBuildError(f"{instance_id} stopped without reporting success")
            if state in ("terminated", "shutting-down"):
                raise ImageBuildError(f"{instance_id} ended unexpectedly ({state})")
        raise TimeoutError(f"{instance_id} did not finish within {timeout_seconds}s")

    def read_console(self, instance_id: str) -> str:
        output = self.ec2.get_console_output(InstanceId=instance_id, Latest=True).get("Output")
        return output or ""

    def create_image(self, instance_id: str, name: str, build_hash: str) -> str:
        image_id = self.ec2.create_image(
            InstanceId=instance_id,
            Name=name,
            Description=f"Open-Inspect EC2 sandbox base image ({build_hash})",
            TagSpecifications=[
                {"ResourceType": kind, "Tags": [{"Key": BUILD_TAG, "Value": name}]}
                for kind in ("image", "snapshot")
            ],
        )["ImageId"]
        self.ec2.get_waiter("image_available").wait(
            ImageIds=[image_id],
            WaiterConfig={
                "Delay": POLL_INTERVAL_SECONDS,
                "MaxAttempts": IMAGE_TIMEOUT_SECONDS // POLL_INTERVAL_SECONDS,
            },
        )
        return image_id

    def terminate(self, instance_id: str) -> None:
        try:
            self.ec2.terminate_instances(InstanceIds=[instance_id])
        except Exception as error:  # Never mask the build's own outcome.
            print(f"could not terminate {instance_id}: {error}", file=sys.stderr)


def build_archive(bundle_directory: Path) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        tar.add(bundle_directory, arcname=".")
        for name in EC2_FILES:
            tar.add(INFRA / name, arcname=f"ec2/{name}")
    return buffer.getvalue()


def read_required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required")
    return value


def main() -> None:
    builder = Ec2ImageBuilder(
        boto3.session.Session(region_name=read_required_env("AWS_REGION")),
        read_required_env("EC2_SANDBOX_SUBNET_ID"),
        read_required_env("EC2_SANDBOX_SECURITY_GROUP_ID"),
    )
    bucket = read_required_env("EC2_IMAGE_BUILD_BUCKET")
    bundle = pack_bundle(ROOT, "ec2", ROOT / ".cache/sandbox-images")
    build_hash = bundle.plan["buildHash"]
    name = f"{AMI_NAME_PREFIX}-{build_hash[:BUILD_HASH_NAME_CHARS]}"

    existing = builder.find_image(name)
    if existing and existing["State"] != "available":
        raise ImageBuildError(
            f"AMI {name} exists in state {existing['State']}; remove it to rebuild"
        )
    if existing:
        image_id = existing["ImageId"]
        print(f"{name}: re-verifying existing {image_id}", file=sys.stderr)
    else:
        image_id = builder.build_image(name, bucket, bundle.directory, build_hash)

    verify_instance = builder.run_step(
        image_id, verify_script(bundle.plan["runtimeEnv"]), f"{name}-verify", VERIFY_TIMEOUT_SECONDS
    )
    builder.terminate(verify_instance)
    write_build_result(image_id)


if __name__ == "__main__":
    main()
