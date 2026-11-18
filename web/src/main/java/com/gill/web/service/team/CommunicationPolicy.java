package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import static com.gill.web.service.team.TeamData.*;
import static com.gill.web.service.team.TaskAdoption.createTask;

/** Directed communication and immutable task adoption; no transport or SQL. */
final class CommunicationPolicy {
    private CommunicationPolicy() {}
    static ObjectNode send(ObjectNode s,TeamActor a,ObjectNode p) {
        String tid=required(p,"teamId"),text=required(p,"text");team(a,tid);
        ObjectNode t=get(s,"teams",tid);LinkedHashSet<String> targets=new LinkedHashSet<>();
        String intent=intent(a,p);
        boolean assignment=intent.equals("assign"),review=intent.equals("review");
        for(JsonNode n:p.path("mentions"))targets.add(n.asText());
        String reply=text(p,"replyTo");ObjectNode original=null;
        if(!reply.isBlank()) {
            original=get(s,"messages",reply);
            if(!tid.equals(text(original,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 原消息不在本团队");
            if(!p.has("mentions")&&targets.isEmpty()&&text(original,"senderType").equals("employee")&&!text(original,"senderId").equals(a.id()))
                targets.add(text(original,"senderId"));
        }
        if(targets.isEmpty()&&assignment&&reply.isEmpty()&&!text(t,"receiverId").isEmpty())targets.add(text(t,"receiverId"));
        if(targets.isEmpty()&&assignment&&original!=null&&(p.has("intent")||p.path("requiresResponse").asBoolean(false))&&!text(original,"taskId").isBlank())
            targets.add(text(get(s,"tasks",text(original,"taskId")),"employeeId"));
        for(String target:targets) {
            ObjectNode e=get(s,"employees",target);
            if(!tid.equals(text(e,"teamId"))||text(e,"lifecycle").equals("disabled"))
                throw new IllegalArgumentException("SCOPE_FORBIDDEN: 无效或跨团队接收员工");
        }
        String taskId=text(p,"taskId");if(taskId.isBlank()&&original!=null)taskId=text(original,"taskId");
        ObjectNode context=taskId.isBlank()?null:get(s,"tasks",taskId);
        if(context!=null&&!tid.equals(text(context,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 任务不属于本团队");
        TaskFlow.validateApprovalSetting(a,p,assignment&&context==null);
        if(p.path("requireDispatchApproval").asBoolean()&&targets.size()!=1)
            throw new IllegalArgumentException("INVALID_INPUT: 需审批的工作请选择一位负责员工");
        if((review||(assignment&&p.has("intent")))&&targets.isEmpty())
            throw new IllegalArgumentException("INVALID_INPUT: 请选择接收员工或为团队配置接收员工");
        if(assignment&&context==null&&p.has("decisionId"))throw new IllegalArgumentException("INVALID_INPUT: 新工作没有可引用的已有决定");
        if(assignment&&context!=null)TaskFlow.requireDispatchAllowed(s,context,p);
        ObjectNode m=message(s,tid,a.type(),a.id(),text,"chat");m.put("replyTo",reply);
        ArrayNode mentions=m.putArray("mentions");targets.forEach(mentions::add);
        m.put("intent",intent).put("requiresResponse",review||assignment);
        if(context!=null)m.put("taskId",text(context,"id")).put("runId",text(context,"runId"));
        for(String target:targets) {
            if(intent.equals("notify")) {
                String deliveryId=text(m,"id")+":"+target;
                map(s,"deliveries").set(deliveryId,node("id",deliveryId,"messageId",text(m,"id"),"employeeId",target,"state","notified"));
                continue;
            }
            ObjectNode taskInput=p;
            if(review) {
                taskInput=p.deepCopy();
                taskInput.putArray("dependsOnTaskIds");
            }
            ObjectNode task=createTask(s,tid,target,text,context,taskInput);
            if(review)task.put("purpose","review");
            if(assignment)TaskFlow.recordDispatchDependencies(s,task,context,p);
            String deliveryId=text(m,"id")+":"+target;
            ObjectNode d=node("id",deliveryId,"messageId",text(m,"id"),"employeeId",target,"taskId",text(task,"id"),"state","queued");
            map(s,"deliveries").set(deliveryId,d);
            ObjectNode job=node("kind","turn","teamId",tid,"employeeId",target,"taskId",text(task,"id"),"runId",text(task,"runId"),"deliveryId",deliveryId);
            enqueue(s,job);task.put("sourceMessageId",text(m,"id"));
            task.put("sourceDeliveryId",deliveryId);
            m.put("taskId",text(task,"id")).put("runId",text(task,"runId"));
        }
        return node("id",text(m,"id"),"intent",intent).put("recipientCount",targets.size());
    }

    static String intent(TeamActor actor,ObjectNode payload) {
        String intent=payload.has("intent")?required(payload,"intent"):
            actor.human()&&payload.path("requiresResponse").asBoolean(true)?"assign":"notify";
        if(!Set.of("notify","review","assign").contains(intent))
            throw new IllegalArgumentException("INVALID_INPUT: 无效消息动作");
        if(intent.equals("assign")&&!actor.human())
            throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工请使用正式派工入口");
        return intent;
    }
}
