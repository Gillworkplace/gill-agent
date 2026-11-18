package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.*;
import static com.gill.web.service.team.TeamData.*;

/** Lower-level causal dependency and dispatch-version rules shared by policies and gateway. */
public final class TaskFlow {
    private TaskFlow() {}
    public static int generation(JsonNode task){return task.path("generation").asInt(1);}
    public static boolean current(JsonNode task,JsonNode job){return generation(task)==job.path("generation").asInt(1);}
    public static boolean terminal(JsonNode task){return Set.of("completed","cancelled","failed","stopped").contains(text(task,"state"));}

    public static String blockingDecision(ObjectNode s,ObjectNode task) {
        Set<String> dependencies=new HashSet<>();Deque<String> pending=new ArrayDeque<>();pending.add(text(task,"id"));
        while(!pending.isEmpty()) {
            String id=pending.removeFirst();if(id.isBlank()||!dependencies.add(id))continue;
            JsonNode ancestor=map(s,"tasks").path(id);
            if(ancestor.has("dependsOnTaskIds"))for(JsonNode dependency:ancestor.path("dependsOnTaskIds"))pending.add(dependency.asText());
            else if(!text(ancestor,"parentTaskId").isBlank())pending.add(text(ancestor,"parentTaskId"));
        }
        for(JsonNode decision:map(s,"decisions")) {
            if(!text(decision,"state").equals("open")||!dependencies.contains(text(decision,"taskId")))continue;
            boolean assessor=false;
            for(String ancestor:dependencies) {
                JsonNode assessment=map(s,"tasks").path(ancestor);
                if(text(assessment,"assessmentDecisionId").equals(text(decision,"id"))&&
                    text(assessment,"employeeId").equals(text(decision,"handlerId")))assessor=true;
            }
            if(!assessor)return text(decision,"id");
        }
        return "";
    }
    public static void requireWorkAllowed(ObjectNode s,ObjectNode task) {
        if(terminal(task))throw new IllegalArgumentException("INVALID_STATE: 原任务已结束，不能派发后续工作");
        if(!blockingDecision(s,task).isBlank())throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 相关事项等待明确决定，不能继续派工或执行");
    }
    public static void requireHandoffAllowed(ObjectNode s,ObjectNode task) {
        if(!text(task,"state").equals("completed"))requireWorkAllowed(s,task);
        else if(!blockingDecision(s,task).isBlank())throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 相关事项等待明确决定");
    }
    static void requireDispatchAllowed(ObjectNode s,ObjectNode task,ObjectNode input) {
        requireHandoffAllowed(s,task);
        ObjectNode source=task;
        while(text(source,"purpose").equals("review")&&!text(source,"parentTaskId").isBlank()) {
            source=get(s,"tasks",text(source,"parentTaskId"));
            requireHandoffAllowed(s,source);
        }
        requireDispatchApproval(s,task);
        if(input.has("decisionId")) {
            ObjectNode decision=get(s,"decisions",required(input,"decisionId"));
            ObjectNode origin=get(s,"tasks",text(decision,"taskId"));
            if(!text(task,"runId").equals(text(origin,"runId")))
                throw new IllegalArgumentException("SCOPE_FORBIDDEN: 派工所依赖的决定必须属于本次工作");
            if(!text(decision,"state").equals("applied"))
                throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 派工所依赖的决定尚未生效");
        }
    }
    public static boolean needsDispatchApproval(ObjectNode s,ObjectNode task) {
        JsonNode work=map(s,"workItems").path(text(task,"workItemId"));
        return work.path("requireDispatchApproval").asBoolean()&&text(work,"dispatchApprovalDecisionId").isBlank();
    }
    static void requireDispatchApproval(ObjectNode s,ObjectNode task) {
        if(needsDispatchApproval(s,task))
            throw new IllegalArgumentException("DISPATCH_APPROVAL_REQUIRED: 本次工作需获得用户明确许可后才能正式派工或集成");
    }
    static void validateApprovalSetting(TeamActor actor,ObjectNode input,boolean newWork) {
        if(!input.has("requireDispatchApproval"))return;
        if(!actor.human())throw new IllegalArgumentException("SCOPE_FORBIDDEN: 只有用户可设置派工审批");
        if(!newWork||!input.path("requireDispatchApproval").isBoolean())
            throw new IllegalArgumentException("INVALID_INPUT: 派工审批只可在创建工作时设置");
    }
    static void recordDispatchDependencies(ObjectNode s,ObjectNode task,ObjectNode source,ObjectNode input) {
        if(input.has("decisionId"))task.put("dispatchDependencyDecisionId",text(input,"decisionId"));
        if(source==null||!text(source,"purpose").equals("review")||
            (input.path("dependsOnTaskIds").isArray()&&input.path("dependsOnTaskIds").isEmpty()))return;
        while(text(source,"purpose").equals("review")&&!text(source,"parentTaskId").isBlank()) {
            source=get(s,"tasks",text(source,"parentTaskId"));
            list(task,"dependsOnTaskIds").add(text(source,"id"));
        }
    }
    public static void holdDependents(ObjectNode s,String runId) {
        for(JsonNode n:map(s,"tasks")) {
            ObjectNode task=(ObjectNode)n;
            if(!runId.equals(text(task,"runId"))||terminal(task))continue;
            String decision=blockingDecision(s,task);
            if(!decision.isBlank()&&(!text(task,"state").equals("blocked")||task.has("waitingDecisionId")||text(task,"decisionId").equals(decision)))
                task.put("state","blocked").put("waitingDecisionId",decision).put("reason","相关事项等待明确决定");
        }
    }
    public static void releaseDependents(ObjectNode s,String decisionId,String answer) {
        for(JsonNode n:map(s,"tasks")) {
            ObjectNode task=(ObjectNode)n;
            if(!decisionId.equals(text(task,"waitingDecisionId"))||terminal(task))continue;
            String other=blockingDecision(s,task);
            if(!other.isBlank()){task.put("waitingDecisionId",other);continue;}
            task.put("state","queued").put("decisionAnswer",answer).put("generation",generation(task)+1);
            task.remove(List.of("waitingDecisionId","reason"));
        }
    }
    public static void invalidateDecisions(ObjectNode s,ObjectNode task,String reason) {
        for(JsonNode n:map(s,"decisions")) {
            ObjectNode d=(ObjectNode)n;
            if(!text(d,"taskId").equals(text(task,"id"))||!text(d,"state").equals("open"))continue;
            d.put("state","superseded").put("invalidReason",reason).put("revision",d.path("revision").asInt()+1);
            for(JsonNode m:map(s,"messages"))if(text(m,"decisionId").equals(text(d,"id")))((ObjectNode)m).put("status","superseded");
            for(JsonNode t:map(s,"tasks"))if(text(t,"assessmentDecisionId").equals(text(d,"id"))&&!terminal(t))
                ((ObjectNode)t).put("state","cancelled").put("reason",reason);
        }
    }
}
