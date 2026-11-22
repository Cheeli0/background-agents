"""The EC2 image: the launcher's environment checks and the AMI builder's scripts."""

import json
import runpy
import shlex
from pathlib import Path

import pytest

INFRA = Path(__file__).resolve().parents[3] / "packages/ec2-infra"
EXEC_RUNTIME = runpy.run_path(str(INFRA / "exec-runtime.py"))
main = EXEC_RUNTIME["main"]
SCRIPTS = runpy.run_path(str(INFRA / "image_scripts.py"))


def write(tmp_path: Path, payload: object) -> Path:
    path = tmp_path / "session.json"
    path.write_text(json.dumps(payload))
    return path


def test_accepts_a_bootstrap_response_and_reports_its_lifetime(tmp_path, capsys):
    path = write(tmp_path, {"sandboxId": "sb-1", "env": {"SANDBOX_TIMEOUT_SECONDS": "3600"}})

    assert main(["--check", str(path)]) == 0
    assert main(["--lifetime-seconds", str(path)]) == 0
    assert capsys.readouterr().out.strip() == "3600"


@pytest.mark.parametrize(
    "payload",
    [
        [],
        {"sandboxId": "sb-1"},
        {"sandboxId": "", "env": {"SANDBOX_TIMEOUT_SECONDS": "60"}},
        {"sandboxId": "sb-1", "env": {"SANDBOX_TIMEOUT_SECONDS": 60}},
        {"sandboxId": "sb-1", "env": {"SANDBOX_TIMEOUT_SECONDS": "0"}},
        {"sandboxId": "sb-1", "env": {}},
    ],
)
def test_refuses_anything_else_without_echoing_values(tmp_path, capsys, payload):
    path = write(tmp_path, payload)

    assert main(["--check", str(path)]) == 1
    assert "sb-1" not in capsys.readouterr().err


def test_refuses_a_file_that_is_not_json(tmp_path):
    path = tmp_path / "session.json"
    path.write_text("<html>")

    assert main(["--check", str(path)]) == 1


def test_every_file_the_image_installs_exists():
    for name in SCRIPTS["EC2_FILES"]:
        assert (INFRA / name).is_file()


def test_build_script_keeps_a_hostile_bundle_url_one_shell_word():
    url = "https://bucket.example/key?a=1&b='; reboot #"
    script = SCRIPTS["build_script"](url)

    assert shlex.split(f"curl {shlex.quote(url)}")[1] == url
    assert shlex.quote(url) in script


def test_a_rejected_file_never_echoes_its_secrets(tmp_path, capsys):
    path = write(tmp_path, {"sandboxId": "sb-1", "env": {"TOKEN": "secret-value", "N": 12345}})

    assert main(["--check", str(path)]) == 1
    error = capsys.readouterr().err
    assert "env.N" in error
    assert "secret-value" not in error
    assert "12345" not in error
