"""Start a local Docker executor for the logged-in Gill workspace."""
import asyncio
import json
import logging
import os
import platform
import shutil
import subprocess
from pathlib import Path

import httpx
import typer

from gill_core.config import Settings
from gill_core.team_local_sandbox import LocalWorker
from gill_core.team_worker import run_team_workers


_CONFIG_KEYS = {"GILL_TEAM_WORKER_SECRET", "GILL_TEAM_BUNDLE_MAX_BYTES", "GILL_LOCAL_EXECUTOR_IMAGE", "ZHIPU_API_KEY",
                "ZHIPU_BASE_URL", "ZHIPU_MODEL", "MINIO_ENDPOINT", "MINIO_ROOT_USER", "MINIO_ROOT_PASSWORD", "MINIO_BUCKET"}


def _load_environment(path: Path) -> None:
    for line in path.read_text(encoding="utf-8").splitlines():
        key, separator, value = line.partition("=")
        key = key.strip()
        if separator and key in _CONFIG_KEYS:
            value = value.strip()
            if len(value) >= 2 and value[0] in "\"'" and value[-1] == value[0]:
                value = value[1:-1]
            os.environ.setdefault(key, value)


def _binding(directory: Path, project: str | None) -> tuple[str, LocalWorker]:
    credentials = Path(os.getenv("GILL_CLI_CREDENTIALS", str(Path.home() / ".gill" / "credentials")))
    if not credentials.is_file():
        raise ValueError("请先用 gill login 登录执行任务所在的 Gill 服务")
    profile = json.loads(credentials.read_text(encoding="utf-8"))
    server = profile["server"].rstrip("/")
    with httpx.Client(base_url=server, headers={"Authorization": f"Bearer {profile['token']}"}, trust_env=False) as client:
        account = client.get("/api/v1/auth/me")
        account.raise_for_status()
        project_id = ""
        if project:
            response = client.get("/api/v1/team-workspace")
            response.raise_for_status()
            choices = [p["id"] for p in response.json()["projects"].values() if project in (p["name"], p["id"])]
            if len(choices) != 1:
                raise ValueError("项目名不存在或不唯一，请使用项目 ID")
            project_id = choices[0]
    runner = LocalWorker(directory.resolve(strict=True), int(account.json()["id"]), project_id,
                         f"{platform.node()}:{Path.home().resolve()}")
    return server, runner


def team_worker(directory: Path = typer.Option(None, "--directory", "-d", exists=True, file_okay=False,
                                               help="CLI 所在机器上的工作目录，默认当前目录"),
                project: str = typer.Option(None, "--project", help="项目名称或 ID，省略时仅领取未关联项目的任务"),
                slots: int = typer.Option(2, "--slots", min=1, max=16, help="本机并行执行数"),
                env_file: Path = typer.Option(None, "--env-file", exists=True, dir_okay=False,
                                              help="可选的 Gill 执行器配置文件")) -> None:
    """
    在本机 Docker 中执行 Gill 团队任务。\f

    :param directory: Host source directory to use, defaulting to the current directory.
    :param project: Optional Gill project name or ID in the logged-in workspace.
    :param slots: Number of jobs the CLI can execute concurrently.
    :param env_file: Optional file providing allowed execution environment settings.
    """
    try:
        if env_file:
            _load_environment(env_file)
        if len(os.getenv("GILL_TEAM_WORKER_SECRET", "")) < 32:
            raise ValueError("请配置与部署匹配的 GILL_TEAM_WORKER_SECRET")
        if not shutil.which("docker"):
            raise ValueError("请安装并启动 CLI 所在机器上的 Docker")
        host = os.getenv("DOCKER_HOST") or subprocess.run(
            ["docker", "context", "inspect", "--format", "{{.Endpoints.docker.Host}}"],
            capture_output=True, text=True, timeout=10, check=True).stdout.strip()
        if not host.startswith("unix://"):
            raise ValueError("请在 CLI 所在机器选择本机 Docker context")
        image = os.getenv("GILL_LOCAL_EXECUTOR_IMAGE", "gill-local-executor:latest")
        if subprocess.run(["docker", "image", "inspect", image], capture_output=True, timeout=10).returncode:
            raise ValueError(f"本地 Docker 未启动或缺少执行镜像 {image}")
        server, binding = _binding(directory or Path.cwd(), project)
        settings = Settings.load(binding.directory)
        settings.zhipu_model = os.getenv("ZHIPU_MODEL", settings.zhipu_model)
        if not settings.zhipu_api_key:
            raise ValueError("请配置 ZHIPU_API_KEY")
        logging.basicConfig(level=logging.INFO, format="%(message)s")
        logging.getLogger("httpx").setLevel(logging.WARNING)
        typer.echo(f"CLI 执行器已启动，目录 {binding.directory}，项目 {project or '未关联项目'}，并发 {slots}")
        asyncio.run(run_team_workers(settings, binding, server, slots))
    except (ValueError, OSError, subprocess.SubprocessError, httpx.HTTPError) as error:
        typer.echo(str(error), err=True)
        raise typer.Exit(1) from error
    except KeyboardInterrupt:
        typer.echo("CLI 执行器已退出，工作区保留在本机磁盘。")
