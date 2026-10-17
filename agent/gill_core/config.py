"""集中配置：环境变量 > 项目 .gill/config.toml > 默认值（FR-114 三层体系）。"""
from __future__ import annotations
import os
from dataclasses import dataclass, field
from pathlib import Path


def _load_toml(p: Path) -> dict:
    try:
        import tomllib
        with p.open("rb") as f:
            return tomllib.load(f)
    except Exception:
        return {}


def load_config(project_dir: Path | None = None) -> dict:
    """按 全局 → 项目 → env 顺序合并（浅层嵌套一层 [section]）。"""
    cfg: dict = {}
    for p in [Path.home() / ".gill" / "config.toml",
              *( [project_dir / ".gill" / "config.toml"] if project_dir else [] )]:
        for k, v in _load_toml(p).items():
            if isinstance(v, dict):
                cfg.setdefault(k, {}).update(v)
            else:
                cfg[k] = v
    for k, v in os.environ.items():          # GILL_SERVER -> server / GILL_RUN__TIMEOUT -> run.timeout
        if k.startswith("GILL_") and k != "GILL_TOKEN":
            key = k[5:].lower().replace("__", ".")
            cur: dict | str = cfg
            parts = key.split(".")
            for i, part in enumerate(parts):
                if i == len(parts) - 1:
                    cur[part] = v
                else:
                    cur = cur.setdefault(part, {})
    return cfg


@dataclass
class Settings:
    # LLM
    zhipu_api_key: str = field(default_factory=lambda: os.getenv("ZHIPU_API_KEY", ""))
    zhipu_base_url: str = "https://open.bigmodel.cn/api/paas/v4"
    zhipu_model: str = os.getenv("ZHIPU_MODEL", "glm-4.6")
    embed_model: str = os.getenv("ZHIPU_EMBED_MODEL", "embedding-3")
    # 沙箱
    sandbox: str = os.getenv("GILL_SANDBOX", "mock")          # mock | remote
    cube_api_url: str = os.getenv("CUBE_API_URL", "http://127.0.0.1:13000")  # 隧道默认；直连改 http://39.107.34.109:3000
    cube_ip: str = os.getenv("CUBE_PROXY_NODE_IP", "127.0.0.1")              # *.cube.app 重定向目标（隧道=127.0.0.1；直连=39.107.34.109）
    e2b_api_key: str = os.getenv("E2B_API_KEY", "e2b_00000000000000000000000000000")
    cube_template_id: str = os.getenv("CUBE_TEMPLATE_ID", "tpl-4264d9c2e5d6432e8a55cf4e")
    sandbox_idle_ttl: int = 900                                # 沙箱空闲回收（秒）
    # 任务预算（FR-11.4.2）
    max_rounds: int = 25
    cmd_timeout: int = 60
    llm_timeout: int = 120
    task_timeout: int = 900
    max_tool_failures: int = 5
    approval: str = "auto"                                     # auto | suggest
    approval_timeout: int = 120
    # 知识库
    kb_inject_max: int = 8
    kb_inject_tokens: int = 2000

    @staticmethod
    def load(project_dir: Path | None = None) -> "Settings":
        c = load_config(project_dir)
        s = Settings()
        for sec in ("llm", "run", "kb"):
            for k, v in (c.get(sec) or {}).items():
                if hasattr(s, k):
                    setattr(s, k, v)
        for k in ("zhipu_api_key", "zhipu_model", "sandbox", "approval", "e2b_api_url"):
            if c.get(k):
                setattr(s, k, c[k])
        return s
