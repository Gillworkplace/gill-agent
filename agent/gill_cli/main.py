"""gill CLI 主入口：chat / run / doctor / version（FR-111~117 逐步实现）。"""
# 注意：本文件不能使用 from __future__ import annotations —— typer 需要运行时真实类型注解
import asyncio
import json
import sys
from pathlib import Path

import typer
from rich.console import Console
from rich.markdown import Markdown
from rich.panel import Panel

from gill_core import __version__
from gill_core.config import Settings
from gill_core.loop import run_task

app = typer.Typer(add_completion=False, help="Gill Agent CLI", no_args_is_help=True,
                  context_settings={"help_option_names": ["-h", "--help"]})
console = Console()

SYSTEM_HINT = "\n约定：回答用简洁中文；给结论和产物路径；不要输出多余客套。"


async def _emit_to_console(kind: str, payload: dict):
    if kind == "terminal":
        console.print(payload.get("data", ""), end="", style="dim" if payload.get("stream") == "stderr" else "green")
    elif kind == "tool_call":
        args_s = json.dumps(payload.get("args", {}), ensure_ascii=False)
        console.print(f"[cyan]▶ {payload['tool']}[/cyan] {args_s[:120]}")
    elif kind == "approval_request":
        console.print(Panel.fit(f"[red]{payload['riskLevel'].upper()}[/red] {payload['reason']}\n"
                                f"[bold]{payload['command']}[/bold]", title="需要审批 (y/n/a)"))


async def _console_approve(command: str, rule) -> bool:
    import time
    from rich.prompt import Prompt
    deadline = time.time() + 120
    while time.time() < deadline:
        a = Prompt.ask("批准执行?", choices=["y", "n", "a"], default="n",
                       console=console, show_default=True)
        if a == "a":
            _console_approve.always = True   # type: ignore[attr-defined]
            return True
        return a == "y"
    return False


def _run(task: str, s: Settings, history: list | None = None) -> tuple[str, list]:
    hist = list(history or [])
    buf: list[str] = []

    async def emit(kind, payload):
        if kind == "agent_delta":
            buf.append(payload["content"])
        elif kind == "approval_request":
            await _emit_to_console(kind, payload)
        else:
            await _emit_to_console(kind, payload)

    r = asyncio.run(run_task(task + SYSTEM_HINT, s, emit, hist,
                             approve=_console_approve if s.approval == "suggest" else None))
    hist.append({"role": "user", "content": task})
    if r.answer:
        hist.append({"role": "assistant", "content": r.answer})
    return r.answer or "", hist


@app.command()
def chat(prompt: str = typer.Argument(None, help="初始任务；留空进入交互 REPL"),
         sandbox: str = typer.Option("mock", "--sandbox", "-s", help="mock | remote"),
         approval: str = typer.Option(None, "--approval", help="auto | suggest 覆盖配置")):
    """交互式对话（默认命令）。"""
    s = Settings.load(Path.cwd()); s.sandbox = sandbox
    if approval:
        s.approval = approval
    if not s.zhipu_api_key:
        console.print("[red]未配置 ZHIPU_API_KEY（环境变量或 config.toml）[/red]"); raise typer.Exit(1)
    console.print(f"[dim]model={s.zhipu_model} sandbox={s.sandbox} approval={s.approval}，输入 exit 退出[/dim]")
    history: list[dict] = []
    if prompt:
        ans, history = _run(prompt, s, history)
        console.print(Markdown(ans))
    while True:
        try:
            line = console.input("[bold]你> [/bold]").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if not line or line in {"exit", "quit"}:
            break
        ans, history = _run(line, s, history)
        console.print(Markdown(ans))


@app.command()
def run(task_file: str = typer.Argument("-", help="任务文件路径，- 代表 stdin"),
        json_out: bool = typer.Option(False, "--json", help="机器可读输出 gill.run.v1"),
        yes: bool = typer.Option(False, "-y", "--yes", help="非交互；suggest 高危自动拒绝"),
        sandbox: str = typer.Option("mock", "--sandbox")):
    """非交互执行任务（CI/脚本，FR-116）。退出码 0 成功/1 失败/2 用法错误。"""
    text = (Path(task_file).read_text(encoding="utf-8") if task_file != "-" else sys.stdin.read()).strip()
    if not text:
        console.print("[red]任务内容为空[/red]"); raise typer.Exit(2)
    s = Settings.load(Path.cwd()); s.sandbox = sandbox
    if yes:
        s.approval = "suggest"
    buf: list[str] = []

    async def emit(kind, payload):
        if kind == "agent_delta":
            buf.append(payload["content"])
        elif not json_out:
            await _emit_to_console(kind, payload)

    r = asyncio.run(run_task(text + SYSTEM_HINT, s, emit,
                             approve=(lambda c, rule: asyncio.sleep(0) or False) if yes else None))
    if json_out:
        console.print_json(json.dumps({
            "schema": "gill.run.v1", "status": r.status, "rounds": r.rounds,
            "tokens": r.tokens, "tools": r.tools, "answer_md": "".join(buf)}, ensure_ascii=False))
    else:
        console.print(Markdown("".join(buf) or r.answer))
    raise typer.Exit(0 if r.status == "done" else 1)


@app.command()
def doctor():
    """环境自检（FR-117）：配置/Key 连通/沙箱可用。"""
    s = Settings.load(Path.cwd())
    ok = True

    def item(name, good, detail=""):
        nonlocal ok
        ok &= good
        console.print(f"{'[green]✔[/green]' if good else '[red]✘[/red]'} {name} {detail}")
    item("API Key 配置", bool(s.zhipu_api_key))
    if s.zhipu_api_key:
        try:
            from openai import AsyncOpenAI
            async def ping():
                c = AsyncOpenAI(api_key=s.zhipu_api_key, base_url=s.zhipu_base_url, timeout=15)
                await c.models.list()
            asyncio.run(asyncio.wait_for(ping(), 20))
            item("智谱 API 连通", True, s.zhipu_base_url)
        except Exception as e:
            item("智谱 API 连通", False, str(e)[:80])
    item("沙箱模式", True, s.sandbox)
    if s.sandbox == "mock":
        r = asyncio.run(s.__class__.load(Path.cwd()).sandbox and _mock_probe())
        item("MockSandbox(docker)", r)
    raise typer.Exit(0 if ok else 1)


async def _mock_probe() -> bool:
    from gill_core.sandbox import MockSandbox
    r = await MockSandbox().run("echo ok", timeout=60)
    return r.exit_code == 0


@app.command()
def version():
    """版本信息。"""
    console.print(f"gill {__version__}")


if __name__ == "__main__":
    app()
