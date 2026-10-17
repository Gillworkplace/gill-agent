"""Agent 任务循环：流式输出 + 工具调用 + 审批钩子 + 预算控制（FR-31~38）。"""
from __future__ import annotations
import asyncio
import json
from dataclasses import dataclass, field
from typing import Awaitable, Callable
from .config import Settings
from .llm import LLM
from .sandbox import BaseSandbox, make_sandbox
from .tools import TOOLS_SCHEMA, ToolEvent, execute
from . import risk

Emitter = Callable[[str, dict], Awaitable[None]]      # (event_type, payload)
Approver = Callable[[str, risk.Rule], Awaitable[bool]]  # (command, rule) -> approve?


@dataclass
class TaskResult:
    status: str = "done"            # done|failed|stopped
    rounds: int = 0
    tokens: dict = field(default_factory=dict)
    tools: list = field(default_factory=list)
    answer: str = ""


class TaskStopped(Exception):
    pass


async def run_task(task_text: str, settings: Settings,
                   emit: Emitter, history: list[dict] | None = None,
                   approve: Approver | None = None,
                   stop_flag: Callable[[], bool] | None = None,
                   llm: LLM | None = None, sandbox: BaseSandbox | None | object = None) -> TaskResult:
    llm = llm or LLM(settings)
    sandbox = sandbox or make_sandbox(settings)
    messages = list(history or []) + [{"role": "user", "content": task_text}]
    result = TaskResult()
    always_ok: set[str] = set()
    failures = 0
    try:
        for rnd in range(1, settings.max_rounds + 1):
            if stop_flag and stop_flag():
                raise TaskStopped()
            result.rounds = rnd
            round_text: list[str] = []
            tool_calls: list[dict] = []
            usage = {}
            async for kind, payload in llm.stream(messages, TOOLS_SCHEMA):
                if kind == "delta":
                    round_text.append(payload)
                    await emit("agent_delta", {"content": payload})
                elif kind == "tool_calls":
                    tool_calls = payload
                elif kind == "usage":
                    usage = payload
            if usage:
                result.tokens = {"prompt": result.tokens.get("prompt", 0) + usage.get("prompt", 0),
                                 "completion": result.tokens.get("completion", 0) + usage.get("completion", 0)}
            if round_text:
                messages.append({"role": "assistant", "content": "".join(round_text)})
            if not tool_calls:
                result.answer = "".join(round_text)
                return result
            # 执行工具（串行；同轮多调用按序）
            for tc in tool_calls:
                if stop_flag and stop_flag():
                    raise TaskStopped()
                name = tc["function"]["name"]
                args = json.loads(tc["function"]["arguments"] or "{}")
                if settings.approval == "suggest" and name == "shell":
                    rule = risk.assess(args.get("command", ""))
                    if rule and rule.id not in always_ok:
                        await emit("approval_request", {
                            "cid": tc["id"], "command": args.get("command", ""),
                            "riskLevel": rule.level, "reason": rule.reason, "ruleId": rule.id})
                        ok = (await approve(args["command"], rule)) if approve else False
                        if not ok:
                            messages.append({"role": "assistant", "content": None,
                                             "tool_calls": [tc]})
                            messages.append({"role": "tool", "tool_call_id": tc["id"],
                                             "content": "用户拒绝了该命令的执行（或超时自动拒绝）。请改用安全方式或询问用户。"})
                            await emit("tool_result", {"tool": name, "exit_code": -2, "denied": True})
                            continue
                        if approve is not None and getattr(approve, "always", False):
                            always_ok.add(rule.id)
                await emit("agent_tool", {"round": rnd, "tool": name})
                out = await execute(sandbox, name, args, lambda ev: emit(ev.kind, ev.payload), settings)
                result.tools.append({"name": name, "ok": '"error"' not in out[:60]})
                failures = failures + (1 if '"error"' in out[:60] else 0)
                if failures >= settings.max_tool_failures:
                    result.status = "failed"
                    result.answer = "连续工具失败达到上限，任务终止。"
                    return result
                messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out})
        result.status = "failed"
        result.answer = f"已达轮次上限（{settings.max_rounds}）。"
        return result
    except TaskStopped:
        result.status = "stopped"
        return result
    except Exception as e:
        result.status = "failed"
        result.answer = f"任务失败：{e}"
        return result
