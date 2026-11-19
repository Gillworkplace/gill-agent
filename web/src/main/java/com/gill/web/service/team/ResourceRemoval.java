package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.JsonNodeFactory;
import com.fasterxml.jackson.databind.node.ObjectNode;
import static com.gill.web.service.team.TeamData.*;

/** Remove workspace definitions while retaining copied configuration and execution evidence. */
final class ResourceRemoval {
    private ResourceRemoval() {}

    static ObjectNode remove(ObjectNode state, TeamActor actor, String kind, ObjectNode input) {
        human(actor);
        String id = required(input, "id");
        String group = switch (kind) {
            case "orgTemplate.delete" -> "organizationTemplates";
            case "template.delete" -> "templates";
            case "team.delete" -> "teams";
            case "role.delete" -> "teamRoles";
            case "employee.delete" -> "employees";
            case "knowledge.delete" -> "knowledge";
            case "project.delete" -> "projects";
            case "document.delete" -> "documents";
            default -> throw new IllegalArgumentException("UNSUPPORTED_ACTION: " + kind);
        };
        ObjectNode owner = group.equals("documents") ? get(state, "projects", required(input, "projectId")) : state;
        ObjectNode record = get(owner, group, id);
        revision(record, input);
        switch (group) {
            case "teams" -> {
                for (String children : new String[]{"employees", "teamRoles", "projects"}) {
                    if (references(state, children, "teamId", id))
                        throw new IllegalArgumentException("RESOURCE_IN_USE: 请先删除团队下的成员、角色及项目");
                }
                ensureTeamIdle(state, id);
            }
            case "teamRoles" -> {
                if (references(state, "employees", "roleId", id))
                    throw new IllegalArgumentException("RESOURCE_IN_USE: 请先在成员配置中解除该角色关联");
            }
            case "employees" -> {
                if (references(state, "employees", "parentId", id))
                    throw new IllegalArgumentException("RESOURCE_IN_USE: 请先为直属下级调整上级");
                deleteEmployee(state, actor, record);
            }
            case "projects" -> {
                if (!record.path("documents").isEmpty())
                    throw new IllegalArgumentException("RESOURCE_IN_USE: 请先删除项目下的文档");
                for (JsonNode task : map(state, "tasks")) {
                    JsonNode work = map(state, "workItems").path(text(task, "workItemId"));
                    if (id.equals(text(work, "projectId")) && !TaskFlow.terminal(task)) throw busy();
                }
            }
            case "knowledge" -> unmountKnowledge(state, actor, id);
            default -> { }
        }
        map(owner, group).remove(id);
        return node("id", id).put("deleted", true);
    }

    private static boolean references(ObjectNode state, String group, String field, String id) {
        for (JsonNode record : map(state, group)) {
            if (id.equals(text(record, field))) return true;
        }
        return false;
    }

    private static void ensureTeamIdle(ObjectNode state, String teamId) {
        for (JsonNode task : map(state, "tasks")) {
            if (teamId.equals(text(task, "teamId")) && !TaskFlow.terminal(task)) throw busy();
        }
    }

    private static void deleteEmployee(ObjectNode state, TeamActor actor, ObjectNode employee) {
        String id = text(employee, "id"), teamId = text(employee, "teamId");
        for (JsonNode task : map(state, "tasks")) {
            if (!teamId.equals(text(task, "teamId")) || TaskFlow.terminal(task)) continue;
            if (id.equals(text(task, "employeeId"))) throw busy();
            for (JsonNode supervisor : task.path("teamSnapshot").path("organization")) {
                if (id.equals(supervisor.asText())) throw busy();
            }
        }
        ObjectNode team = get(state, "teams", teamId).deepCopy();
        boolean receiver = id.equals(text(team, "receiverId"));
        boolean inTree = map(team, "organization").remove(id) != null;
        if (receiver) team.put("receiverId", "");
        if (receiver || inTree) save(state, "teams", team, actor);
    }

    private static void unmountKnowledge(ObjectNode state, TeamActor actor, String id) {
        for (JsonNode member : map(state, "employees")) {
            ArrayNode remaining = JsonNodeFactory.instance.arrayNode();
            JsonNode mounts = member.path("knowledgeIds");
            for (JsonNode source : mounts) {
                if (!id.equals(source.asText())) remaining.add(source);
            }
            if (remaining.size() == mounts.size()) continue;
            ObjectNode updated = ((ObjectNode) member).deepCopy();
            updated.set("knowledgeIds", remaining);
            save(state, "employees", updated, actor);
        }
    }

    private static IllegalArgumentException busy() {
        return new IllegalArgumentException("BUSY: 仍有相关任务未结束，请先完成或停止任务");
    }
}
