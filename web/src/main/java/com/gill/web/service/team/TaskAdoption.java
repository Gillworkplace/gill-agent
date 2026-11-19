package com.gill.web.service.team;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import static com.gill.web.service.team.TeamData.*;
/** Create and preview the three independent task configuration snapshots. */
final class TaskAdoption {
 private TaskAdoption() {}
    static ObjectNode createTask(ObjectNode s,String tid,String employee,String goal,ObjectNode parent,ObjectNode p) {
        ObjectNode e=get(s,"employees",employee);
        String runId=parent==null?id():required(parent,"runId");
        ObjectNode team=get(s,"teams",tid);
        if(parent==null) {
            String projectId=text(p,"projectId");
            ObjectNode project=projectId.isBlank()?null:get(s,"projects",projectId);
            if(project!=null&&!tid.equals(text(project,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 项目跨团队");
            ObjectNode run=node("id",runId,"teamId",tid,"goal",goal,"state","active","createdAt",now());
            run.put("manualPaused",false).put("controlRevision",0).put("calls",0);
            run.set("limits",team.path("limits").deepCopy());map(s,"runs").set(runId,run);
            String wi=id();ObjectNode work=node("id",wi,"teamId",tid,"runId",runId,"goal",goal,"projectId",text(p,"projectId"),"state","active");
            if(p.path("requireDispatchApproval").asBoolean())work.put("requireDispatchApproval",true);
            if(project!=null)work.set("projectSnapshot",project.deepCopy());
            map(s,"workItems").set(wi,work);run.put("workItemId",wi);
        }
        ObjectNode run=get(s,"runs",runId);
        if(!tid.equals(text(run,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 跨团队运行");
        if(parent!=null)requireProject(s,run);
        ObjectNode task=node("id",id(),"teamId",tid,"employeeId",employee,"runId",runId,"goal",goal,"state","queued","createdAt",now());
        task.put("revision",1).put("parentTaskId",parent==null?"":text(parent,"id")).put("workItemId",text(run,"workItemId"));
        task.put("generation",1);
        ArrayNode dependencies=task.putArray("dependsOnTaskIds");
        if(p.has("dependsOnTaskIds")) {
            if(!p.path("dependsOnTaskIds").isArray())throw new IllegalArgumentException("INVALID_INPUT: dependsOnTaskIds需为数组");
            for(JsonNode id:p.path("dependsOnTaskIds")) {
                ObjectNode dependency=get(s,"tasks",id.asText());
                if(!runId.equals(text(dependency,"runId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 依赖任务必须属于同一工作运行");
                dependencies.add(id.asText());
            }
        } else if(parent!=null)dependencies.add(text(parent,"id"));
        task.set("employeeSnapshot",e.deepCopy());ObjectNode teamSnapshot=team.deepCopy();
        ObjectNode role=roleFor(s,e);
        if(role!=null)task.set("roleSnapshot",role.deepCopy().retain("id","name","revision","prompt","promptFiles","skills"));
        ObjectNode organization=teamSnapshot.putObject("organization");
        for(JsonNode member:map(s,"employees"))if(tid.equals(text(member,"teamId")))organization.put(text(member,"id"),text(member,"parentId"));
        task.set("teamSnapshot",teamSnapshot);
        map(s,"tasks").set(text(task,"id"),task);
        if(text(run,"state").equals("completed"))run.put("state","active");
        return task;
    }
    static ObjectNode roleFor(ObjectNode state,JsonNode member) {
        JsonNode role=map(state,"teamRoles").path(text(member,"roleId"));
        return role instanceof ObjectNode object&&text(member,"teamId").equals(text(role,"teamId"))?object:null;
    }
    static void requireProject(ObjectNode state, JsonNode run) {
        String projectId=text(map(state,"workItems").path(text(run,"workItemId")),"projectId");
        if(!projectId.isBlank())get(state,"projects",projectId);
    }
    static ObjectNode preview(ObjectNode state,String teamId,String employeeId,String taskId) {
        ObjectNode result=node();
        if(!taskId.isBlank()) {
            ObjectNode task=get(state,"tasks",taskId);
            if(!teamId.equals(text(task,"teamId"))||!employeeId.equals(text(task,"employeeId")))
                throw new IllegalArgumentException("SCOPE_FORBIDDEN: 任务不属于该成员");
            result.set("team",previewFields(task.path("teamSnapshot")));
            result.set("employee",previewFields(task.path("employeeSnapshot")));
            result.set("role",task.path("roleSnapshot").isObject()?previewFields(task.path("roleSnapshot")):NullNode.instance);
            return result.put("taskId",taskId);
        }
        ObjectNode team=get(state,"teams",teamId),employee=get(state,"employees",employeeId);
        if(!teamId.equals(text(employee,"teamId")))
            throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工属于其他团队");
        ObjectNode role=roleFor(state,employee);
        result.set("team",previewFields(team));
        result.set("employee",previewFields(employee));
        result.set("role",role==null?NullNode.instance:previewFields(role));
        return result;
    }
    private static JsonNode previewFields(JsonNode record) {
        return record instanceof ObjectNode object?object.deepCopy().retain(
            "id","name","revision","prompt","personality","promptFiles","templateId","templateRevision","files","skills"):NullNode.instance;
    }
}
