#!/usr/bin/env python3
"""Validate a kept EC2 session environment and exec the runtime from it; see README.md."""

from __future__ import annotations

import argparse
import os
import pwd
import shutil
import sys
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field, ValidationError

PYTHON = "/opt/openinspect/python/bin/python"
RUNTIME_USER = "user"
WORKSPACE = Path("/workspace")
STATE_DIR = Path(f"/home/{RUNTIME_USER}/.openinspect")
RUNTIME_STATE_DIR = STATE_DIR / "state"
BOOT_COMPLETE_MARKER = STATE_DIR / "boot-complete"
SUPERVISOR_LOG = STATE_DIR / "supervisor.log"
USER_DIRECTORIES = (
    STATE_DIR,
    RUNTIME_STATE_DIR,
    Path("/tmp/opencode"),
    Path(f"/home/{RUNTIME_USER}/.cache/openinspect/scm"),
)
LIFETIME_KEY = "SANDBOX_TIMEOUT_SECONDS"
FALLBACK_PATH = "/usr/local/bin:/usr/bin:/bin"
LOG_MODE = 0o600


class SessionEnvironmentError(ValueError):
    """The kept file is not a session environment the control plane returned."""


class SessionEnvironment(BaseModel):
    model_config = ConfigDict(strict=True)

    sandbox_id: str = Field(alias="sandboxId", min_length=1)
    env: dict[str, str]


def load_environment(path: Path) -> dict[str, str]:
    try:
        session = SessionEnvironment.model_validate_json(path.read_text())
    except ValidationError as error:
        # Locations only: pydantic's own message would echo the secret values.
        fields = ", ".join(".".join(map(str, issue["loc"])) or "<root>" for issue in error.errors())
        raise SessionEnvironmentError(f"invalid session environment fields: {fields}") from None
    read_lifetime_seconds(session.env)
    return session.env


def read_lifetime_seconds(environment: dict[str, str]) -> int:
    value = int(environment[LIFETIME_KEY])
    if value <= 0:
        raise SessionEnvironmentError(f"{LIFETIME_KEY} must be positive")
    return value


def prepare_user_directories(account: pwd.struct_passwd) -> None:
    for directory in USER_DIRECTORIES:
        directory.mkdir(parents=True, exist_ok=True)
        os.chown(directory, account.pw_uid, account.pw_gid)
    if SUPERVISOR_LOG.exists():
        shutil.move(SUPERVISOR_LOG, SUPERVISOR_LOG.with_suffix(".log.1"))


def exec_runtime(path: Path, is_restored: bool) -> None:
    environment = load_environment(path)
    account = pwd.getpwnam(RUNTIME_USER)
    prepare_user_directories(account)
    environment.update(
        {
            "OPENINSPECT_STATE_DIR": str(RUNTIME_STATE_DIR),
            "OI_BOOT_COMPLETE_MARKER": str(BOOT_COMPLETE_MARKER),
            "RESTORED_FROM_SNAPSHOT": "true" if is_restored else "false",
            "HOME": account.pw_dir,
            "USER": RUNTIME_USER,
            "LOGNAME": RUNTIME_USER,
            "SHELL": account.pw_shell,
            "PATH": environment.get("PATH", FALLBACK_PATH),
        }
    )
    os.initgroups(RUNTIME_USER, account.pw_gid)
    os.setgid(account.pw_gid)
    os.setuid(account.pw_uid)
    log = os.open(SUPERVISOR_LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, LOG_MODE)
    os.dup2(log, sys.stdout.fileno())
    os.dup2(log, sys.stderr.fileno())
    os.close(log)
    os.chdir(WORKSPACE)
    os.execve(PYTHON, [PYTHON, "-m", "sandbox_runtime.entrypoint"], environment)


def parse_bool(value: str) -> bool:
    if value not in ("true", "false"):
        raise argparse.ArgumentTypeError("expected true or false")
    return value == "true"


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", type=Path)
    mode.add_argument("--lifetime-seconds", type=Path)
    mode.add_argument("--run", type=Path)
    parser.add_argument("--restored", type=parse_bool, default=False)
    args = parser.parse_args(argv)

    try:
        if args.check:
            load_environment(args.check)
        elif args.lifetime_seconds:
            print(read_lifetime_seconds(load_environment(args.lifetime_seconds)))
        else:
            exec_runtime(args.run, args.restored)
    except (OSError, ValueError, KeyError) as error:
        # Names the problem, never a value from the file.
        print(f"exec-runtime: {type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
