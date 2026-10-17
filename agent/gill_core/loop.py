"""Agent 任务循环：流式输出 + 工具调用 + 审批钩子 + 预算控制（FR-31~38）。"""
from __future__ import annotations
import asyncio
import json
from dataclasses import dataclass, field
from typing import Awaitable, Callable
from .config import Settings
from .llm import LLM, SYSTEM_PROMPT
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
                   llm: LLM | None = None, sandbox: BaseSandbox | None | object = None,
                   kb=None, system_extra: str = "", always_ok_rules: set[str] | None = None,
                   exts=None) -> TaskResult:
    llm = llm or LLM(settings)
    sandbox = sandbox or make_sandbox(settings)
    messages = list(history or []) + [{"role": "user", "content": task_text}]
    result = TaskResult()
    always_ok: set[str] = always_ok_rules if always_ok_rules is not None else set()
    failures = 0
    captured: list[str] = []
    system = SYSTEM_PROMPT + system_extra
    if kb is not None:
        try:
            block = await kb.build_injection(task_text, settings.kb_inject_max, settings.kb_inject_tokens)
            if block:
                messages = [{"role": "system", "content": block},
                            *messages[:-1],
                            {**messages[-1], "content": block + "\n\n[当前任务]\n" + task_text}]
        except Exception as e:
            log_kb = __import__("logging").getLogger("gill.loop")
            log_kb.warning("kb inject fail: %s", e)
    try:
        for rnd in range(1, settings.max_rounds + 1):
            if stop_flag and stop_flag():
                raise TaskStopped()
            result.rounds = rnd
            round_text: list[str] = []
            tool_calls: list[dict] = []
            usage = {}
            ext_schemas = []
            if exts:
                try:
                    from .exts import tool_schemas
                    ext_schemas = tool_schemas(exts)
                except Exception as e:
                    log_kb = __import__("logging").getLogger("gill.loop")
                    log_kb.warning("ext schemas fail: %s", e)
            async for kind, payload in llm.stream(messages, TOOLS_SCHEMA + ext_schemas):
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
                if approve is not None and name == "shell":   # 审批门：回调存在即启用（agentd 会话档位控制）
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
                if name.startswith("ext_") and exts:
                    from .exts import execute_http
                    await emit("tool_call", {"tool": name, "args": args})
                    out = await execute_http(sandbox, exts, name, args, emit=emit)
                    result.tools.append({"name": name, "ok": '"error"' not in out[:60]})
                    messages.append({"role": "tool", "tool_call_id": tc["id"], "content": out[:4000]})
                    continue
                out = await execute(sandbox, name, args, lambda ev: emit(ev.kind, ev.payload), settings, kb=kb)
                if name == "knowledge_save" and kb is not None:
                    try:
                        import json as _json
                        r = _json.loads(out)
                        if r.get("ok"):
                            captured.append(args["title"])
                            await emit("kb_captured", {"ids": [r.get("id")], "titles": captured})
                    except Exception:
                        pass
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
