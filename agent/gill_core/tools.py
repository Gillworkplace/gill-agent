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
    {"type": "function", "function": {
        "name": "knowledge_save",
        "description": "把有长期价值的信息存入用户知识库：用户偏好(preference)、用户/团队事实(fact)、纠错(correction)、项目知识(project)、常用片段(snippet)。当用户表达长期偏好、纠正你、或给出项目事实时调用。",
        "parameters": {"type": "object", "properties": {
            "title": {"type": "string", "description": "短标题（≤30字）"},
            "content": {"type": "string", "description": "知识内容（客观、可独立理解）"},
            "type": {"type": "string", "enum": ["preference", "fact", "correction", "project", "snippet"]},
            "tags": {"type": "array", "items": {"type": "string"}}},
            "required": ["title", "content", "type"]}}},
    {"type": "function", "function": {
        "name": "knowledge_search",
        "description": "检索用户知识库（用户偏好/事实/项目知识等长期记忆）。",
        "parameters": {"type": "object", "properties": {
            "query": {"type": "string"}, "limit": {"type": "integer", "default": 5}},
            "required": ["query"]}}},
]

TAIL = 8000  # 工具结果入库/回模型的截断（01 §11.4.4）


@dataclass
class ToolEvent:
    kind: str          # tool_call | terminal | tool_result
    payload: dict


async def execute(sandbox: BaseSandbox, name: str, args: dict,
                  emit: Callable[[ToolEvent], Awaitable[None]],
                  settings, kb=None) -> str:
    """执行一个工具调用，返回给模型的结果文本（错误信息也作为结果返回，由模型决策）。"""
    await emit(ToolEvent("tool_call", {"tool": name, "args": args}))
    try:
        if name == "knowledge_save" and kb is not None:      # FR-91 自动沉淀
            r = await kb.save(args["title"], args["content"], args.get("type", "fact"),
                              args.get("tags"), source="auto", confidence=0.8)
            await emit(ToolEvent("tool_result", {"tool": name, "exit_code": 0, "kb": r}))
            return json.dumps({"ok": True, **r}, ensure_ascii=False)
        if name == "knowledge_search" and kb is not None:
            hits = await kb.search(args["query"], int(args.get("limit", 5)))
            await kb.touch([h["id"] for h in hits])
            await emit(ToolEvent("tool_result", {"tool": name, "exit_code": 0, "hits": len(hits)}))
            return json.dumps(hits, ensure_ascii=False)[:4000]
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
