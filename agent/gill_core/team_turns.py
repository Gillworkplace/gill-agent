"""可恢复的模型轮次执行，工具副作用先存意图再保存真实回执。"""
from __future__ import annotations
import asyncio
import hashlib
import json
import logging
import time
import httpx
from .config import Settings
from .team_client import TeamClient
from .llm import LLM
from .team_protocol import ACTION_NAMES, build_system, parse_calls, tool_schemas, search_sources
from .team_sandbox import TeamSandbox

log = logging.getLogger(__name__)


class TeamTurn:
    """Execute one leased job using separate model history and sandbox references."""

    def __init__(self, client: TeamClient, settings: Settings, job: dict) -> None:
        """
        Initialize this execution.

        :param client: Authenticated internal TeamClient.
        :param settings: Project model and sandbox settings.
        :param job: Fenced durable work item.
        """
        self.client, self.settings, self.job = client, settings, job
        self.control = {}
        self.lost = False
        self.sandbox = None
        self.context = {}
        self.history = []
        self.turn = 0
        self.read_knowledge = {}
        self.last_usage = {}
        self.model_cancelled = False

    async def op(self, operation: str, **payload) -> dict:
        """
        Submit an operation for this execution.

        :param operation: Internal operation name.
        :param payload: Operation fields.
        :returns: Committed operation response.
        """
        try:
            return await self.client.operation(self.job, operation, **payload)
        except httpx.HTTPStatusError as error:
            if operation == "action-result" and "LEASE_LOST" in error.response.text:
                self.lost = True
                try:
                    await self.client.operation(self.job, "late-result", **payload)
                except Exception:
                    log.warning("late result not confirmed job=%s", self.job["id"])
            raise

    async def heartbeat(self) -> None:
        """Renew the lease independently of model and tool waits."""
        while True:
            await asyncio.sleep(5)
            try:
                self.control = await self.op("heartbeat")
            except Exception:
                self.lost = True
                return

    def stopping(self) -> bool:
        """
        Determine whether another model or action may be dispatched.

        :returns: True when the lease, control or task state prevents dispatch.
        """
        return self.lost or self.control.get("state") in {
            "pause_requested", "paused", "stop_requested", "stopped", "needs_reconciliation"
        } or (self.context.get("kind") != "integration" and self.control.get("taskState") in {"blocked", "cancelled", "completed"})

    def key(self, identifier: str) -> str:
        """
        Derive a stable action identity across checkpoint replay.

        :param identifier: Persisted model turn or tool call identifier.
        :returns: Hexadecimal SHA256 request key.
        """
        return hashlib.sha256(f"{self.job['id']}:{identifier}".encode()).hexdigest()

    async def command(self, kind: str, arguments: dict, identifier: str) -> dict:
        """
        Apply one structured model command with server-derived identity.

        :param kind: Registered domain command.
        :param arguments: Validated command arguments.
        :param identifier: Persisted call ID.
        :returns: Committed command response.
        """
        return await self.op("command", kind=kind, payload=arguments, requestKey=self.key(identifier))

    async def run(self) -> None:
        """Run the leased job and preserve failures, controls and checkpoints."""
        pulse = asyncio.create_task(self.heartbeat())
        state, result = "done", {}
        try:
            self.context = await self.op("context")
            checkpoint = self.context.get("checkpoint", {})
            self.history = checkpoint.get("messages", [])
            self.turn = checkpoint.get("turn", 0)
            self.read_knowledge = {x["id"]: x for x in checkpoint.get("knowledge", [])}
            self.read_knowledge.update(self.context.get("retainedKnowledge", {}))
            if self.context.get("kind") == "integration":
                await self.integration()
            else:
                await self.conversation(checkpoint)
            if self.control.get("state") in {"pause_requested", "paused", "stop_requested", "stopped"}:
                state = "stopped" if self.control.get("state") in {"stop_requested", "stopped"} else "paused"
        except Exception as error:
            log.warning("team execution failed job=%s type=%s", self.job["id"], type(error).__name__)
            state = "needs_reconciliation" if getattr(error, "external_unknown", False) else "failed"
            result = {"error": str(error)[:700]}
        finally:
            pulse.cancel()
            try:
                await pulse
            except asyncio.CancelledError:
                pass
            if not self.lost:
                try:
                    await self.op("finish", state=state, result=result)
                except Exception:
                    log.warning("team finish unconfirmed job=%s", self.job["id"])

    async def conversation(self, checkpoint: dict) -> None:
        """
        Continue a persisted conversation at model/tool boundaries.

        :param checkpoint: Last committed model response and pending tool calls.
        """
        pending = checkpoint.get("pending", [])
        if pending:
            await self.execute_calls(pending)
        if not self.history:
            self.history = self.initial_messages()
        started = time.monotonic()
        for _ in range(self.settings.max_rounds):
            self.control = await self.op("heartbeat")
            if self.stopping():
                return
            self.context = await self.op("context")
            for source in self.context.get("knowledge", []):
                self.read_knowledge[source["id"]] = source
            if time.monotonic() - started > self.settings.task_timeout:
                await self.command("issue.escalate", {"problem": "执行达到配置时长上限，需要决定后续。",
                                                     "attempts": [], "options": ["保留成果后继续", "停止"]}, "timeout")
                return
            self.turn += 1
            turn_key = self.key("model-" + str(self.turn))
            intent = await self.op("action", requestKey=turn_key, kind="model",
                                   input={"turn": self.turn, "model": self.settings.zhipu_model})
            if intent["state"] in {"paused", "budget_exceeded"}:
                self.control["state"] = "paused"
                return
            if intent["state"] == "succeeded":
                receipt = intent.get("result", intent)
                text, calls = receipt.get("answer", ""), receipt.get("toolCalls", [])
            elif intent["state"] == "dispatched":
                self.context = await self.op("context")
                for source in self.context.get("knowledge", []):
                    self.read_knowledge[source["id"]] = source
                try:
                    text, calls = await self.model_request()
                except Exception as error:
                    status = getattr(error, "status_code", None)
                    if status is not None and 400 <= status < 500 and status not in {408, 409}:
                        await self.op("action-result", requestKey=turn_key, state="failed",
                                      result={"error": str(error)[:700], "providerRejected": True, "httpStatus": status})
                    raise
                await self.op("action-result", requestKey=turn_key, state="failed" if self.model_cancelled else "succeeded",
                              result={"answer": text, "toolCalls": calls, "usage": self.last_usage or "not_reported", "cancelled": self.model_cancelled})
                if self.model_cancelled:
                    await self.save_checkpoint([])
                    return
            else:
                raise RuntimeError("Model request requires reconciliation before replay")
            self.history.append({"role": "assistant", "content": text or None, **({"tool_calls": calls} if calls else {})})
            await self.save_checkpoint(calls)
            if not calls:
                if text:
                    if self.context.get("kind") == "template":
                        raise ValueError("模型未生成结构化模板草稿，请继续对话或重试")
                    await self.command("message.send", {"text": text, "mentions": []}, "answer-" + str(self.turn))
                return
            await self.execute_calls(calls)
            if self.context.get("kind") == "template":
                return

    def initial_messages(self) -> list[dict]:
        """
        Build authorized initial messages without mixing independent requirements.

        :returns: OpenAI-compatible message dictionaries.
        """
        if self.context.get("kind") == "template":
            draft = self.context["draft"]
            messages = list(draft.get("messages", []))
            if draft.get("prompt"):
                messages.insert(0, {"role": "user", "content": "保留并继续完善这份当前草稿：" + json.dumps(
                    {k: draft.get(k) for k in ("name", "prompt", "skills")}, ensure_ascii=False)})
            return messages
        payload = {"task": self.context.get("task"), "messages": self.context.get("messages"),
                   "decision": self.context.get("decision"), "project": self.context.get("project"),
                   "artifacts": self.context.get("artifacts")}
        return [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}]

    async def model_request(self) -> tuple[str, list[dict]]:
        """
        Stream one model response with explicitly supplied effective instructions.

        :returns: Complete text and complete function calls.
        """
        template = self.context.get("kind") == "template"
        system = ("你帮助用户通过多轮对话定义通用数字员工模板。根据已有草稿和最新要求调用draft_template，"
                  "生成名称、完整工作Prompt和可复用Skills。保留用户明确要求，不固定行业岗位。")
        if not template:
            system = build_system(self.context)
            current = {"taskGoal": self.context.get("task", {}).get("goal"),
                       "decisionAnswer": self.context.get("task", {}).get("decisionAnswer"),
                       "decision": self.context.get("decision"), "recentMessages": self.context.get("messages"),
                       "availableArtifacts": self.context.get("artifacts")}
            system += "\n[本轮最新工作事实，按引用版本处理]\n" + json.dumps(current, ensure_ascii=False)
            if self.read_knowledge:
                sources = [{"id": s["id"], "revision": s.get("revision"), "title": s.get("title"),
                            "content": s.get("content", "")[:10000]} for s in self.read_knowledge.values()]
                system += "\n[已授权读取的资料，引用时标来源版本]\n" + json.dumps(sources, ensure_ascii=False)
        self.model_cancelled = False
        self.last_usage = {}
        request = asyncio.create_task(self._consume_model(template, system))
        try:
            while not request.done():
                await asyncio.wait([request], timeout=0.2)
                if self.stopping() and not request.done():
                    request.cancel()
                    try:
                        await request
                    except asyncio.CancelledError:
                        pass
                    self.model_cancelled = True
                    return "", []
            return await request
        finally:
            if not request.done():
                request.cancel()

    async def _consume_model(self, template: bool, system: str) -> tuple[str, list[dict]]:
        parts, calls = [], []
        llm = LLM(self.settings)
        # Each persisted model intent authorizes one request, with no hidden SDK retries.
        llm.client.max_retries = 0
        try:
            async for kind, payload in llm.stream(self.history, tool_schemas(template), system=system):
                if kind == "delta":
                    parts.append(payload)
                elif kind == "tool_calls":
                    calls = payload
                elif kind == "usage":
                    self.last_usage = payload
        finally:
            await llm.client.close()
        return "".join(parts), calls

    async def save_checkpoint(self, calls: list[dict]) -> None:
        """
        Persist response and call IDs before external execution.

        :param calls: Complete pending calls, or an empty list after application.
        """
        await self.op("checkpoint", checkpoint={"messages": self.history, "turn": self.turn, "pending": calls,
                                                "knowledge": list(self.read_knowledge.values())})

    async def execute_calls(self, calls: list[dict]) -> None:
        """
        Apply complete calls and checkpoint each observed result.

        :param calls: Persisted complete tool calls.
        """
        batch = list(zip(parse_calls(calls), calls))
        escalation_pending = any(call["name"] == "ask_superior" for call, _ in batch)
        if escalation_pending:
            first_escalation = next(i for i, (call, _) in enumerate(batch) if call["name"] == "ask_superior")
            before, waiting = batch[:first_escalation], batch[first_escalation:]
            reports = [entry for entry in waiting if self.new_completion_report(entry[0]) is not None]
            batch = before + reports + [entry for entry in waiting if entry not in reports]
        for index, (call, _) in enumerate(batch):
            self.control = await self.op("heartbeat")
            if self.stopping():
                return
            try:
                if escalation_pending and self.conflicts_with_escalation(call):
                    output = {"error": "DECISION_PENDING: 本轮请求上报问题，相关工作与完成须等待决定。",
                              "executed": False}
                    if (report := self.new_completion_report(call)) is not None:
                        saved = await self.save_tool_report(call["id"], report)
                        output = {**output, "artifactId": saved["id"], "artifactSaved": True,
                                  "completionApplied": False}
                else:
                    output = await self.dispatch(call)
            except Exception as error:
                if getattr(error, "external_unknown", False):
                    raise
                output = {"error": str(error)[:1200], "executed": False}
            self.history.append({"role": "tool", "tool_call_id": call["id"],
                                 "content": json.dumps(output, ensure_ascii=False)})
            await self.save_checkpoint([raw for _, raw in batch[index + 1:]])

    @staticmethod
    def new_completion_report(call: dict) -> dict | None:
        """
        Find evidence that can be preserved without altering an existing artifact.

        :param call: Parsed tool call.
        :returns: New report payload or None.
        """
        report = call["arguments"].get("artifact")
        if call["name"] == "complete_task" and isinstance(report, dict) and not {"id", "expectedRevision"}.intersection(report):
            return report
        return None

    async def save_tool_report(self, identifier: str, report: dict) -> dict:
        """
        Persist explicitly submitted evidence under the tool call's stable identity.

        :param identifier: Persisted model tool call ID.
        :param report: Submitted artifact payload.
        :returns: Committed artifact response with id (str) and revision (int).
        """
        if not isinstance(report, dict):
            raise ValueError("Report must be an object")
        if set(report) - {"id", "expectedRevision", "title", "content", "unchecked", "remaining"}:
            raise ValueError("Report contains unsupported fields")
        return await self.command("artifact.save", report, identifier + "-artifact")

    @staticmethod
    def conflicts_with_escalation(call: dict) -> bool:
        """
        Identify dependent work that cannot precede a decision from the same response.

        :param call: Parsed call with a registered name and arguments object.
        :returns: Whether dispatch would start dependent work or conclude the task.
        """
        name, args = call["name"], call["arguments"]
        if name == "assign_task":
            return args.get("dependsOnTaskIds") != []
        if name == "update_task":
            return "employeeId" in args or args.get("state") in {"queued", "completed"}
        return name in {"complete_task", "request_integration"}

    async def dispatch(self, call: dict) -> dict:
        """
        Dispatch only registered domain commands or isolated tools.

        :param call: Parsed call containing id, name and arguments.
        :returns: Actual command/tool result dictionary.
        """
        name, args = call["name"], call["arguments"]
        if name == "complete_task" and "artifact" in args:
            await self.save_tool_report(call["id"], args["artifact"])
            return await self.command("run.complete", {}, call["id"])
        if name == "ask_superior" and "evidence" in args:
            evidence = args["evidence"]
            attempts = args.get("attempts", [])
            if not isinstance(evidence, dict) or {"id", "expectedRevision"}.intersection(evidence) or not isinstance(attempts, list):
                raise ValueError("Decision evidence must be a new report with attempts as an array")
            saved = await self.save_tool_report(call["id"], evidence)
            payload = {key: value for key, value in args.items() if key != "evidence"}
            receipt = f"已归档依据：{evidence['title']}（{saved['id']}，v{saved['revision']}）"
            payload["attempts"] = [*attempts, receipt]
            return {**await self.command("issue.escalate", payload, call["id"]), "evidenceArtifactId": saved["id"]}
        if name in {"notify_team", "team_message"}:
            notice = {key: args[key] for key in ("text", "mentions", "replyTo") if key in args}
            # The gateway treats employee messages as notices, including in-flight legacy calls.
            if name == "team_message":
                if "requiresResponse" in args:
                    notice["requiresResponse"] = args["requiresResponse"]
                return await self.command("message.send", notice, call["id"])
            return await self.command("message.send", {**notice, "intent": "notify"}, call["id"])
        if name == "request_peer_review":
            review = {"text": args["text"], "mentions": [args["employeeId"]], "intent": "review"}
            if "replyTo" in args:
                review["replyTo"] = args["replyTo"]
            return await self.command("message.send", review, call["id"])
        if name in ACTION_NAMES:
            result = await self.command(ACTION_NAMES[name], args, call["id"])
            if name == "record_review":
                return {"reviewId": result["id"], "artifactId": args["artifactId"],
                        "subjectRevision": args["subjectRevision"]}
            return result
        if name == "search_knowledge":
            return search_sources(self.context.get("knowledge", []), args["query"])
        key = self.key(call["id"])
        intent = await self.op("action", requestKey=key, kind=name, input=args)
        if intent["state"] in {"succeeded", "failed"}:
            receipt = intent.get("result", intent)
            if name == "save_version" and intent["state"] == "succeeded":
                await self.command("version.record", {k: v for k, v in receipt.items() if k not in {"id", "state"}}, call["id"] + "-version")
            return receipt
        if intent["state"] != "dispatched":
            return {"state": intent["state"], "executed": False}
        try:
            await self.ensure_sandbox()
            output = await self.execute_tool(name, args)
        except Exception as error:
            await self.op("action-result", requestKey=key, state="unknown", result={"error": str(error)[:500]})
            unknown = RuntimeError("工具结果未知，需核实后继续：" + str(error)[:300])
            unknown.external_unknown = True
            raise unknown from error
        status = "failed" if output.get("exitCode", 0) != 0 else "succeeded"
        await self.op("action-result", requestKey=key, state=status, result=output)
        if name == "save_version" and status == "succeeded":
            await self.command("version.record", {k: v for k, v in output.items() if k not in {"id", "state"}}, call["id"] + "-version")
        return output

    async def ensure_sandbox(self) -> None:
        """Lazily create/connect this execution's resource and persist its actual ID."""
        if self.sandbox:
            return
        self.sandbox = TeamSandbox(self.settings, self.context.get("sandboxId", ""))
        identifier = await self.sandbox.connect()
        await self.op("sandbox", sandboxId=identifier)
        if self.context.get("project"):
            from .team_git import TeamGit
            prepared = await TeamGit(self.sandbox, self.context).prepare()
            if prepared.get("exitCode", 0) != 0:
                raise RuntimeError(prepared.get("stderr", "工作区初始化失败"))

    async def execute_tool(self, name: str, args: dict) -> dict:
        """
        Execute a registered remote tool.

        :param name: Tool name validated by the protocol registry.
        :param args: Tool-specific arguments.
        :returns: Actual tool result dictionary.
        """
        if name == "shell":
            return await self.sandbox.run(args["command"], int(args.get("timeout", self.settings.cmd_timeout)))
        if name == "file_write":
            return await self.sandbox.write(args["path"], args["content"])
        if name == "file_read":
            return await self.sandbox.read(args["path"])
        if name == "save_version":
            from .team_git import TeamGit
            return await TeamGit(self.sandbox, self.context).save(args["summary"])
        raise ValueError("Unsupported isolated tool")

    async def integration(self) -> None:
        """Verify and integrate the configured local Git source without claiming a remote push."""
        from .team_git import TeamGit
        request = self.context["integration"]
        key = self.key("integration-" + request["id"])
        intent = await self.op("action", requestKey=key, kind="git.integrate", input=request)
        if intent["state"] == "succeeded":
            result = intent.get("result", intent)
        elif intent["state"] == "dispatched":
            await self.ensure_sandbox()
            result = await TeamGit(self.sandbox, self.context).integrate(request, self.context["sourceVersion"])
            await self.op("action-result", requestKey=key, state="succeeded" if result.get("state") == "verified" else "failed", result=result)
        else:
            raise RuntimeError("集成结果需要核实")
        await self.command("integration.result", {"integrationId": request["id"], "result": result}, "integration-result")
        if result.get("state") != "verified":
            await self.command("issue.escalate", {"problem": "项目集成未完成，需要评估检查/冲突结果。",
                                                 "attempts": [result.get("stderr", "")[-1000:]], "options": ["修正后重新检查", "保留源版本"]}, "integration-conflict")
