"""内置工具：Schema 定义 + 分发执行（全部经沙箱，FR-32/33/51）。"""
from __future__ import annotations
import json
from dataclasses import dataclass
from typing import Awaitable, Callable
from .sandbox import BaseSandbox

TOOLS_SCHEMA = [
    {"type": "function", "function": {
        "name": "shell",
        "description": "在沙箱内执行 shell 命令（Linux）。适合安装依赖、运行脚本、查看文件等。",
        "parameters": {"type": "object", "properties": {
            "command": {"type": "string", "description": "要执行的命令"},
            "timeout": {"type": "integer", "description": "超时秒数", "default": 60}},
            "required": ["command"]}}},
    {"type": "function", "function": {
        "name": "file_write",
        "description": "在沙箱内写入文本文件（父目录自动创建）。",
        "parameters": {"type": "object", "properties": {
            "path": {"type": "string"}, "content": {"type": "string"}},
            "required": ["path", "content"]}}},
    {"type": "function", "function": {
        "name": "file_read",
        "description": "读取沙箱内文本文件内容。",
        "parameters": {"type": "object", "properties": {"path": {"type": "string"}},
            "required": ["path"]}}},
]

TAIL = 8000  # 工具结果入库/回模型的截断（01 §11.4.4）


@dataclass
class ToolEvent:
    kind: str          # tool_call | terminal | tool_result
    payload: dict


async def execute(sandbox: BaseSandbox, name: str, args: dict,
                  emit: Callable[[ToolEvent], Awaitable[None]],
                  settings) -> str:
    """执行一个工具调用，返回给模型的结果文本（错误信息也作为结果返回，由模型决策）。"""
    await emit(ToolEvent("tool_call", {"tool": name, "args": args}))
    try:
        if name == "shell":
            cmd = args["command"]
            timeout = min(int(args.get("timeout") or settings.cmd_timeout), 300)
            async def _out(s): await emit(ToolEvent("terminal", {"stream": "stdout", "data": s[-2000:]}))
            async def _err(s): await emit(ToolEvent("terminal", {"stream": "stderr", "data": s[-2000:]}))
            r = await sandbox.run(cmd, timeout=timeout, on_stdout=_out, on_stderr=_err)
            result = f"exit_code={r.exit_code}\n--- stdout ---\n{r.stdout[-TAIL:]}\n--- stderr ---\n{r.stderr[-2000:]}"
            await emit(ToolEvent("tool_result", {"tool": name, "exit_code": r.exit_code}))
            return result
        if name == "file_write":
            await sandbox.write_file(args["path"], args["content"])
            await emit(ToolEvent("tool_result", {"tool": name, "exit_code": 0}))
            return f"written {len(args['content'])} bytes to {args['path']}"
        if name == "file_read":
            content = await sandbox.read_file(args["path"])
            await emit(ToolEvent("tool_result", {"tool": name, "exit_code": 0}))
            return content[-TAIL:]
        return json.dumps({"error": f"unknown tool {name}"})
    except Exception as e:  # 工具失败回模型（FR-35：失败不崩会话）
        await emit(ToolEvent("tool_result", {"tool": name, "exit_code": -1, "error": str(e)[:500]}))
        return json.dumps({"error": str(e)[:500]}, ensure_ascii=False)
