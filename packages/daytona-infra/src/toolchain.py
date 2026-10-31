"""Daytona image transport; installation is owned by sandbox-images."""

from __future__ import annotations

from typing import TYPE_CHECKING

from daytona import CreateSnapshotParams, Daytona, Image, Resources

if TYPE_CHECKING:
    from sandbox_images.bundle import PackedBundle


def build_base_image(bundle: PackedBundle) -> Image:
    plan = bundle.plan
    return (
        Image.base(plan["target"]["base"])
        .add_local_dir(str(bundle.directory), "/tmp/openinspect-image")
        .run_commands("bash /tmp/openinspect-image/packages/sandbox-images/install/install.sh")
        .env(plan["runtimeEnv"] | {"SANDBOX_VERSION": plan["runtimeVersion"]})
        .workdir("/workspace")
    )


def _posix_context_paths(image: Image) -> Image:
    """Write Windows build-context paths with forward slashes.

    The SDK derives each context's archive path with os.path, so on Windows the
    Dockerfile COPY line gets backslashes, which Docker reads as escapes. The
    uploaded tar already stores the entries with forward slashes.
    """
    for context in image._context_list:
        if context.archive_path and "\\" in context.archive_path:
            posix_path = context.archive_path.replace("\\", "/")
            image._dockerfile = image._dockerfile.replace(context.archive_path, posix_path)
            context.archive_path = posix_path
    return image


def create_base_snapshot(
    daytona: Daytona, bundle: PackedBundle, snapshot_name: str, memory_gib: int
) -> None:
    daytona.snapshot.create(
        CreateSnapshotParams(
            name=snapshot_name,
            image=_posix_context_paths(build_base_image(bundle)),
            resources=Resources(memory=memory_gib),
            entrypoint=["python", "-m", "sandbox_runtime.entrypoint"],
        ),
        on_logs=lambda chunk: print(chunk, end="\n"),
    )
