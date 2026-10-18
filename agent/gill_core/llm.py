"""LLM 客户端：智谱 OpenAI 兼容（chat 流式+工具调用；embedding 预留）。"""
from __future__ import annotations
import logging
from typing import AsyncIterator
from openai import AsyncOpenAI
from .config import Settings

log = logging.getLogger("gill.llm")

SYSTEM_PROMPT = """你是 Gill，一个运行在安全沙箱里的工程助理。你可以：
- 用 shell 工具在沙箱内执行命令（Python3/常用工具可用），不要询问用户是否执行，直接做；
- 用 file_write/file_read 操作沙箱文件；
- 完成任务后用简洁中文总结结果；输出代码/路径/结论要明确。
安全规则：任何操作都只影响沙箱；不要伪造结果，执行失败就报告并尝试修复。
如实汇报：只有工具真实返回成功才可宣称成功；命令被用户拒绝/超时/未执行时，必须明确说明未执行，严禁虚构执行结果。"""


class LLM:
    def __init__(self, s: Settings):
        self.client = AsyncOpenAI(api_key=s.zhipu_api_key, base_url=s.zhipu_base_url, timeout=s.llm_timeout)
        self.model = s.zhipu_model

    async def stream(self, messages: list[dict], tools: list[dict] | None = None,
                     system: str = SYSTEM_PROMPT) -> AsyncIterator:
        """产出 ("delta", text) / ("tool_calls", [tc, ...])；工具调用与文本可同轮出现。"""
        stream = await self.client.chat.completions.create(
            model=self.model, messages=[{"role": "system", "content": system}, *messages],
            tools=tools or None, stream=True)
        text_parts: list[str] = []
        tool_acc: dict[int, dict] = {}
        usage = None
        async for chunk in stream:
            if getattr(chunk, "usage", None):
                usage = chunk.usage
            if not chunk.choices:
                continue
            d = chunk.choices[0].delta
            if d.content:
                text_parts.append(d.content)
                yield ("delta", d.content)
            for tc in (d.tool_calls or []):
                acc = tool_acc.setdefault(tc.index, {"id": "", "name": "", "args": ""})
                if tc.id:
                    acc["id"] = tc.id
                if tc.function and tc.function.name:
                    acc["name"] += tc.function.name
                if tc.function and tc.function.arguments:
                    acc["args"] += tc.function.arguments
        if tool_acc:
            calls = [{"id": a["id"] or f"call_{i}", "type": "function",
                      "function": {"name": a["name"], "arguments": a["args"]}}
                     for i, a in sorted(tool_acc.items())]
            yield ("tool_calls", calls)
        if usage:
            yield ("usage", {"prompt": usage.prompt_tokens, "completion": usage.completion_tokens})
