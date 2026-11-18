package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import static com.gill.web.service.team.TeamData.*;

/** Task, decision, evidence and control transitions inside one aggregate transaction. */
final class RuntimePolicy {
    private RuntimePolicy() {}
    static ObjectNode apply(ObjectNode s,TeamActor a,String kind,ObjectNode p) {
        return switch(kind) {
            case "task.assign" -> assign(s,a,p);
            case "task.update" -> update(s,a,p);
            case "issue.escalate" -> escalate(s,a,p);
            case "decision.respond" -> respond(s,a,p);
            case "run.control" -> control(s,a,p);
            case "artifact.save","check.record" -> evidence(s,a,p,kind);
            case "run.complete" -> complete(s,a,p);
            default -> throw new IllegalArgumentException("UNSUPPORTED_ACTION: "+kind);
        };
    }
    private static ObjectNode assign(ObjectNode s,TeamActor a,ObjectNode p) {
        String target=required(p,"employeeId"),tid=teamOf(s,target);team(a,tid);
        ObjectNode parent=p.has("taskId")?get(s,"tasks",text(p,"taskId")):null;
        if(!a.human()&&(parent==null||!tid.equals(text(parent,"teamId"))))throw new IllegalArgumentException("INVALID_INPUT: 派工需要当前任务");
        if(parent!=null&&!tid.equals(text(parent,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 派工必须属于同一团队");
        TaskFlow.validateApprovalSetting(a,p,parent==null);
        if(parent!=null)TaskFlow.requireDispatchAllowed(s,parent,p);
        else if(p.has("decisionId"))throw new IllegalArgumentException("INVALID_INPUT: 新工作没有可引用的已有决定");
        ObjectNode task=TaskAdoption.createTask(s,tid,target,required(p,"goal"),parent,p);
        TaskFlow.recordDispatchDependencies(s,task,parent,p);
        enqueue(s,node("kind","turn","teamId",tid,"employeeId",target,"taskId",text(task,"id"),"runId",text(task,"runId")));
        ObjectNode notice=message(s,tid,a.type(),a.id(),"安排 "+text(get(s,"employees",target),"name")+"："+text(task,"goal"),"assignment");
        notice.put("taskId",text(task,"id")).put("runId",text(task,"runId"));
        return node("id",text(task,"id"),"messageId",text(notice,"id"));
    }
    private static ObjectNode update(ObjectNode s,TeamActor a,ObjectNode p) {
        ObjectNode task=get(s,"tasks",required(p,"taskId"));TaskAccess.authorize(s,a,task);
        String state=required(p,"state");
        if(p.has("employeeId")&&!text(p,"employeeId").equals(text(task,"employeeId"))) {
            TaskFlow.requireDispatchApproval(s,task);
            String target=required(p,"employeeId");if(!text(task,"teamId").equals(teamOf(s,target)))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 改派员工需属于本团队");
            ObjectNode next=TaskAdoption.createTask(s,text(task,"teamId"),target,text(task,"goal"),task,p);
            next.put("replacesTaskId",text(task,"id"));task.put("state","cancelled").put("replacementTaskId",text(next,"id"));
            TaskFlow.invalidateDecisions(s,task,"任务已改派，原方案决定失效");
            enqueue(s,node("kind","turn","teamId",text(next,"teamId"),"employeeId",target,"taskId",text(next,"id"),"runId",text(next,"runId")));
            return node("id",text(next,"id"),"state","queued");
        }
        if(!Set.of("blocked","queued","completed","failed","cancelled").contains(state))throw new IllegalArgumentException("INVALID_STATE: 无效任务状态");
        if(state.equals("queued")&&task.has("decisionId")&&text(get(s,"decisions",text(task,"decisionId")),"state").equals("open"))
            throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 需要先明确处理决定");
        if(state.equals("completed")) {
            return complete(s,a,p);
        }
        if(state.equals("queued")&&!text(task,"state").equals("queued")) {
            if(!TaskFlow.blockingDecision(s,task).isBlank())throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 相关事项等待明确决定");
            ObjectNode run=get(s,"runs",text(task,"runId"));
            if(text(run,"state").equals("paused")&&!run.path("manualPaused").asBoolean())run.put("state","active");
            task.put("generation",TaskFlow.generation(task)+1);
            enqueue(s,node("kind","turn","teamId",text(task,"teamId"),"employeeId",text(task,"employeeId"),"taskId",text(task,"id"),"runId",text(task,"runId")));
        }
        task.put("state",state).put("reason",text(p,"reason"));task.put("revision",task.path("revision").asInt()+1);
        if(state.equals("cancelled"))TaskFlow.invalidateDecisions(s,task,"任务已取消，原决定失效");
        return node("id",text(task,"id"),"state",state);
    }
    private static ObjectNode escalate(ObjectNode s,TeamActor a,ObjectNode p) {
        ObjectNode task=get(s,"tasks",required(p,"taskId"));TaskAccess.authorize(s,a,task);
        if(TaskFlow.terminal(task))throw new IllegalArgumentException("INVALID_STATE: 已结束的任务不能提交新问题");
        if(task.has("assessmentDecisionId")){ObjectNode reply=p.deepCopy();reply.put("decisionId",text(task,"assessmentDecisionId")).put("answer",required(p,"problem")).put("escalate",true).put("resolved",false);return respond(s,a,reply);}
        if(task.has("decisionId")&&text(get(s,"decisions",text(task,"decisionId")),"state").equals("open"))
            throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 当前任务已有待处理问题");
        String id=id();
        ObjectNode d=node("id",id,"teamId",text(task,"teamId"),"taskId",text(task,"id"),"problem",required(p,"problem"),"state","open","createdAt",now());
        if(p.path("dispatchApproval").asBoolean()) {
            if(!TaskFlow.needsDispatchApproval(s,task)||!text(task,"parentTaskId").isBlank())
                throw new IllegalArgumentException("INVALID_INPUT: 只有启用审批的新工作主任务可申请派工审批");
            d.put("dispatchApproval",true);
        }
        d.put("originEmployeeId",text(task,"employeeId")).put("revision",1);
        d.put("taskRevision",task.path("revision").asInt());
        d.set("options",p.path("options").deepCopy());d.set("attempts",p.path("attempts").deepCopy());d.putArray("path").add(a.id());
        String parent=a.human()?"user":nextSuperior(s,task,a.id(),d);d.put("handlerId",parent);
        map(s,"decisions").set(id,d);task.put("state","blocked").put("decisionId",id);
        deliverDecision(s,d,parent);TaskFlow.holdDependents(s,text(task,"runId"));return node("id",id);
    }
    private static String nextSuperior(ObjectNode s,ObjectNode task,String employee,ObjectNode d) {
        String parent=TaskAccess.parent(s,task,employee);if(parent.equals("user"))return parent;
        JsonNode candidate=map(s,"employees").path(parent);String fault="";
        if(!candidate.isObject())fault="不存在";
        else if(!text(candidate,"teamId").equals(text(task,"teamId")))fault="不属于本团队";
        else if(text(candidate,"lifecycle").equals("disabled"))fault="已禁用";
        for(JsonNode visited:d.path("path"))if(visited.asText().equals(parent))fault="关系循环";
        if(fault.isBlank())return parent;
        String error="上级配置异常："+parent+" "+fault+"，已转交用户评估。";
        d.put("configurationError",text(d,"configurationError")+error);
        list(d,"configurationExceptions").add(node("employeeId",parent,"reason",fault,"at",now()));
        return "user";
    }
    private static void deliverDecision(ObjectNode s,ObjectNode d,String parent) {
        String tid=text(d,"teamId");
        if(parent.equals("user")) {
            ObjectNode m=message(s,tid,"system","system",text(d,"problem")+(d.has("configurationError")?"\n"+text(d,"configurationError"):""),"decision");
            m.put("decisionId",text(d,"id")).put("mentionUser",true).put("status","needs-user");return;
        }
        ObjectNode parentTask=TaskAdoption.createTask(s,tid,parent,"评估问题："+text(d,"problem"),get(s,"tasks",text(d,"taskId")),node());
        parentTask.put("assessmentDecisionId",text(d,"id"));
        enqueue(s,node("kind","turn","teamId",tid,"employeeId",parent,"taskId",text(parentTask,"id"),"runId",text(parentTask,"runId")));
        message(s,tid,"system","system","请上级评估："+text(d,"problem"),"escalation").put("decisionId",text(d,"id"));
    }
    private static ObjectNode respond(ObjectNode s,TeamActor a,ObjectNode p) {
        ObjectNode d=get(s,"decisions",required(p,"decisionId"));team(a,text(d,"teamId"));
        if(!a.human()&&!a.id().equals(text(d,"handlerId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 非当前评估者");
        if(!text(d,"state").equals("open"))throw new IllegalArgumentException("VERSION_CONFLICT: 问题已有明确处理");
        boolean approval=d.path("dispatchApproval").asBoolean(),resolved=p.path("resolved").asBoolean();
        if(p.has("approveDispatch")&&(!a.human()||!approval||!resolved||!p.path("approveDispatch").isBoolean()))
            throw new IllegalArgumentException("SCOPE_FORBIDDEN: 只有用户提交明确决定时可以处理派工审批");
        if(a.human()&&approval&&resolved&&!text(d,"handlerId").equals("user"))
            throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 派工审批仍在上级评估，等待上报给你");
        if(a.human()&&approval&&resolved&&!p.has("approveDispatch"))
            throw new IllegalArgumentException("INVALID_INPUT: 请明确选择是否允许本次工作继续派工");
        if(p.has("expectedRevision"))revision(d,p);
        ObjectNode task=get(s,"tasks",text(d,"taskId"));
        if(!text(task,"state").equals("blocked")||!text(task,"decisionId").equals(text(d,"id"))||task.has("replacementTaskId")||
            (d.has("taskRevision")&&d.path("taskRevision").asInt()!=task.path("revision").asInt()))
            throw new IllegalArgumentException("VERSION_CONFLICT: 原任务或方案已变化，此决定不再适用");
        String answer=required(p,"answer");d.put("answer",answer);
        d.put("revision",d.path("revision").asInt()+1);
        message(s,text(d,"teamId"),a.type(),a.id(),answer,"decision-response").put("decisionId",text(d,"id"));
        if(!a.human()&&(p.path("escalate").asBoolean()||approval&&resolved)) {
            list(d,"path").add(a.id());String parent=nextSuperior(s,task,a.id(),d);
            for(JsonNode assessment:map(s,"tasks"))
                if(text(assessment,"assessmentDecisionId").equals(text(d,"id"))&&text(assessment,"employeeId").equals(a.id())&&!Set.of("completed","cancelled").contains(text(assessment,"state")))
                    ((ObjectNode)assessment).put("state","blocked").put("reason","已向上级升级，等待明确决定");
            d.put("handlerId",parent);deliverDecision(s,d,parent);TaskFlow.holdDependents(s,text(task,"runId"));return node("id",text(d,"id"),"state","open");
        }
        if(!resolved)return node("id",text(d,"id"),"state","open");
        d.put("state","applied").put("appliedAt",now());
        if(approval) {
            boolean approved=p.path("approveDispatch").asBoolean();
            d.put("dispatchApproved",approved);
            if(approved)get(s,"workItems",text(task,"workItemId")).put("dispatchApprovalDecisionId",text(d,"id"));
        }
        for(JsonNode assessment:map(s,"tasks"))if(text(assessment,"assessmentDecisionId").equals(text(d,"id")))((ObjectNode)assessment).put("state","completed").put("decisionResultId",text(d,"id"));
        for(JsonNode m:map(s,"messages"))if(text(m,"decisionId").equals(text(d,"id")))((ObjectNode)m).put("status","responded");
        ObjectNode run=get(s,"runs",text(task,"runId"));
        TaskFlow.releaseDependents(s,text(d,"id"),answer);
        if(!text(task,"state").equals("queued"))task.put("generation",TaskFlow.generation(task)+1);
        task.put("state","queued").put("decisionAnswer",answer);task.remove("waitingDecisionId");
        if(!run.path("manualPaused").asBoolean())enqueue(s,node("kind","turn","teamId",text(task,"teamId"),"employeeId",text(task,"employeeId"),"taskId",text(task,"id"),"runId",text(task,"runId")));
        return node("id",text(d,"id"),"state","applied");
    }
    private static ObjectNode control(ObjectNode s,TeamActor a,ObjectNode p) {
        ObjectNode run=get(s,"runs",required(p,"runId"));team(a,text(run,"teamId"));
        if(!a.human())throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工通过相关任务控制，不可解除人工全局暂停");
        String op=required(p,"operation");
        if(!Set.of("pause","resume","stop").contains(op))throw new IllegalArgumentException("INVALID_INPUT: 无效控制");
        if(op.equals("resume")&&p.path("additionalCalls").asInt()>0){
            ObjectNode limits=map(run,"limits");limits.put("maxRounds",run.path("calls").asInt()+Math.min(p.path("additionalCalls").asInt(),1000));
            for(JsonNode task:map(s,"tasks"))if(text(task,"runId").equals(text(run,"id"))&&text(task,"reason").equals("运行调用上限已达"))((ObjectNode)task).put("state","queued").remove("reason");
        }
        if(op.equals("resume")&&p.path("additionalSeconds").asInt()>0){
            long elapsed=java.time.Duration.between(java.time.Instant.parse(text(run,"createdAt")),java.time.Instant.now()).toSeconds();
            map(run,"limits").put("maxSeconds",elapsed+Math.min(p.path("additionalSeconds").asInt(),86400));
            for(JsonNode task:map(s,"tasks"))if(text(task,"runId").equals(text(run,"id"))&&text(task,"reason").equals("运行调用上限已达"))((ObjectNode)task).put("state","queued").remove("reason");
        }
        if(op.equals("resume")&&(p.path("additionalCalls").asInt()>0||p.path("additionalSeconds").asInt()>0))
            for(JsonNode message:map(s,"messages"))if(text(message,"subjectId").equals(text(run,"id"))&&text(message,"kind").equals("attention"))
                ((ObjectNode)message).put("status","responded");
        run.put("manualPaused",!op.equals("resume")).put("state",op.equals("resume")?"active":op.equals("stop")?"stop_requested":"pause_requested");
        run.put("controlRevision",run.path("controlRevision").asInt()+1);
        return node("id",text(run,"id"),"state",text(run,"state"));
    }
    private static ObjectNode evidence(ObjectNode s,TeamActor a,ObjectNode p,String kind) {
        ObjectNode task=get(s,"tasks",required(p,"taskId"));team(a,text(task,"teamId"));
        if(!a.human()&&!a.id().equals(text(task,"employeeId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 不能冒名登记产物");
        if(kind.equals("check.record")) {
            ObjectNode art=get(s,"artifacts",required(p,"artifactId"));
            if(!text(art,"teamId").equals(text(task,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 核查对象跨团队");
            if(!p.has("subjectRevision"))throw new IllegalArgumentException("INVALID_INPUT: 核查需指定版本");
            JsonNode version=p.path("subjectRevision");
            if(!(version.isIntegralNumber()||(version.isTextual()&&version.asText().matches("[1-9][0-9]*")))||!version.canConvertToInt()&&!version.isTextual()||version.asInt()<=0)
                throw new IllegalArgumentException("INVALID_INPUT: 核查版本需为正整数");
            boolean exists=art.path("revision").asInt()==version.asInt();
            for(JsonNode old:art.path("versions"))if(old.path("revision").asInt()==version.asInt())exists=true;
            if(!exists)throw new IllegalArgumentException("VERSION_CONFLICT: 核查对象版本不存在");
            ObjectNode c=p.deepCopy();c.put("id",id()).put("teamId",text(task,"teamId")).put("employeeId",a.id()).put("createdAt",now());
            c.put("kind","model-assessment");map(s,"checks").set(text(c,"id"),c);return node("id",text(c,"id"));
        }
        String id=text(p,"id");ObjectNode n=id.isBlank()?node("id",id()):get(s,"artifacts",id).deepCopy();
        if(!id.isBlank()){revision(n,p);if(!text(n,"teamId").equals(text(task,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 产物跨团队");}
        n.put("teamId",text(task,"teamId")).put("taskId",text(task,"id")).put("title",required(p,"title")).put("content",required(p,"content"));
        n.put("unchecked",required(p,"unchecked")).put("remaining",text(p,"remaining"));
        return save(s,"artifacts",n,a);
    }
    private static ObjectNode complete(ObjectNode s,TeamActor a,ObjectNode p) {
        ObjectNode task=get(s,"tasks",required(p,"taskId"));TaskAccess.authorize(s,a,task);
        TaskFlow.requireWorkAllowed(s,task);
        String runId=text(task,"runId");boolean artifact=false;
        for(JsonNode v:map(s,"artifacts"))if(text(v,"taskId").equals(text(task,"id")))artifact=true;
        if(!artifact)throw new IllegalArgumentException("EVIDENCE_REQUIRED: 请先登记产物及未验证范围");
        for(JsonNode d:map(s,"decisions"))if(text(d,"taskId").equals(text(task,"id"))&&text(d,"state").equals("open"))throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 决定尚未解决");
        for(JsonNode action:list(task,"executedActions"))if(Set.of("unknown","dispatched").contains(text(action,"state"))&&!action.has("manualResolution"))
            throw new IllegalArgumentException("ACTION_RESULT_UNKNOWN: 外部动作尚未核实");
        for(JsonNode integration:map(s,"integrations"))if(text(integration,"taskId").equals(text(task,"id"))&&text(integration,"state").equals("queued"))
            throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 项目集成尚未完成");
        task.put("state","completed");boolean all=true;
        for(JsonNode t:map(s,"tasks"))if(text(t,"runId").equals(runId)&&!Set.of("completed","cancelled").contains(text(t,"state")))all=false;
        if(all)get(s,"runs",runId).put("state","completed");
        message(s,text(task,"teamId"),"system","system","任务已完成："+text(task,"goal"),"task-completed").put("taskId",text(task,"id"));
        return node("id",text(task,"id"),"state","completed");
    }
}
