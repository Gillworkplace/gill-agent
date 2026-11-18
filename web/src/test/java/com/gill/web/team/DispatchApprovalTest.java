package com.gill.web.team;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.gill.web.service.team.TeamActor;
import com.gill.web.service.team.TeamEngine;
import org.junit.jupiter.api.Test;

import static com.gill.web.service.team.TeamData.node;
import static org.junit.jupiter.api.Assertions.*;

class DispatchApprovalTest {
    private final ObjectNode state = node();
    private final TeamEngine engine = new TeamEngine();
    private final TeamActor user = new TeamActor("user", "1", null);
    private final String team = command("team.create", node("name", "业务团队"));
    private final String template = command("template.save", node("name", "员工", "prompt", "按要求协作"));
    private final String owner = employee("负责人", "user");
    private final String peer = employee("核查员工", "user");

    private String command(String kind, ObjectNode payload) {
        return engine.apply(state, user, kind, payload).path("id").asText();
    }

    private String act(String employee, String kind, ObjectNode payload) {
        return engine.apply(state, new TeamActor("employee", employee, team), kind, payload).path("id").asText();
    }

    private String employee(String name, String parent) {
        return command("employee.create", node("teamId", team, "name", name, "templateId", template, "parentId", parent));
    }

    private String start(String assignee, boolean approval) {
        return command("task.assign", node("employeeId", assignee, "goal", "准备方案").put("requireDispatchApproval", approval));
    }

    private ObjectNode handoff(String task) {
        return node("taskId", task, "employeeId", peer, "goal", "按方案执行");
    }

    private ObjectNode chat(String task) {
        var payload = node("teamId", team, "taskId", task, "text", "请知悉并确认");
        payload.putArray("mentions").add(peer);
        return payload;
    }

    @Test void oldAgentChatFlagCannotDispatchButExplicitPeerReviewCan() {
        String task = start(owner, false);
        String notice = act(owner, "message.send", chat(task).put("requiresResponse", true));
        assertEquals("notify", state.path("messages").path(notice).path("intent").asText());
        assertEquals(1, state.path("tasks").size());

        String review = act(owner, "message.send", chat(task).put("intent", "review"));
        assertEquals("review", state.path("messages").path(review).path("intent").asText());
        assertEquals(2, state.path("tasks").size());
        assertEquals("review", state.path("tasks").path(state.path("messages").path(review).path("taskId").asText()).path("purpose").asText());
        assertThrows(IllegalArgumentException.class, () -> act(owner, "message.send", chat(task).put("intent", "assign")));
        assertFalse(act(owner, "task.assign", handoff(task)).isBlank());
    }

    @Test void requiredApprovalBlocksEveryHandoffUntilExplicitlyGranted() {
        String boss = employee("上级", "user"), lead = employee("方案员工", boss);
        String gated = start(lead, true);
        assertThrows(IllegalArgumentException.class, () -> act(lead, "task.assign", handoff(gated)));
        assertThrows(IllegalArgumentException.class, () -> command("message.send", chat(gated).put("intent", "assign")));
        assertThrows(IllegalArgumentException.class, () -> command("task.update", node("taskId", gated, "employeeId", peer, "state", "queued")));
        assertFalse(act(lead, "message.send", chat(gated).put("intent", "review")).isBlank());
        assertFalse(act(owner, "task.assign", handoff(start(owner, false))).isBlank());

        String decision = act(lead, "issue.escalate", node("taskId", gated, "problem", "请确认范围").put("dispatchApproval", true));
        assertEquals(boss, state.path("decisions").path(decision).path("handlerId").asText());
        var answer = node("decisionId", decision, "answer", "我建议采用方案").put("resolved", true);
        assertThrows(IllegalArgumentException.class, () -> command("decision.respond", answer.deepCopy().put("approveDispatch", true)));
        assertThrows(IllegalArgumentException.class, () -> act(boss, "decision.respond", answer.deepCopy().put("approveDispatch", true)));
        act(boss, "decision.respond", answer);
        assertEquals("user", state.path("decisions").path(decision).path("handlerId").asText());
        command("decision.respond", answer.deepCopy().put("resolved", false));
        assertThrows(IllegalArgumentException.class, () -> act(lead, "task.assign", handoff(gated)));
        command("decision.respond", answer.put("approveDispatch", true));
        assertFalse(act(lead, "task.assign", handoff(gated).put("decisionId", decision)).isBlank());
    }

    @Test void decliningApprovalAndUnrelatedDecisionsKeepTheGateClosed() {
        String gated = start(owner, true);
        String ordinary = act(owner, "issue.escalate", node("taskId", gated, "problem", "请决定报告格式"));
        command("decision.respond", node("decisionId", ordinary, "answer", "简报").put("resolved", true));
        assertThrows(IllegalArgumentException.class, () -> act(owner, "task.assign", handoff(gated).put("decisionId", ordinary)));
        String decision = act(owner, "issue.escalate", node("taskId", gated, "problem", "确认实施").put("dispatchApproval", true));
        command("decision.respond", node("decisionId", decision, "answer", "暂缓实施").put("resolved", true).put("approveDispatch", false));
        assertThrows(IllegalArgumentException.class, () -> act(owner, "task.assign", handoff(gated)));
    }
}
