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
        for(JsonNode n:p.path("mentions"))targets.add(n.asText());
        String reply=text(p,"replyTo");ObjectNode original=null;
        if(!reply.isBlank()) {
            original=get(s,"messages",reply);
            if(!tid.equals(text(original,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 原消息不在本团队");
            if(!p.has("mentions")&&targets.isEmpty()&&text(original,"senderType").equals("employee")&&!text(original,"senderId").equals(a.id()))
                targets.add(text(original,"senderId"));
        }
        if(targets.isEmpty()&&a.human()&&reply.isEmpty()&&!text(t,"receiverId").isEmpty())targets.add(text(t,"receiverId"));
        for(String target:targets) {
            ObjectNode e=get(s,"employees",target);
            if(!tid.equals(text(e,"teamId"))||text(e,"lifecycle").equals("disabled"))
                throw new IllegalArgumentException("SCOPE_FORBIDDEN: 无效或跨团队接收员工");
        }
        ObjectNode m=message(s,tid,a.type(),a.id(),text,"chat");m.put("replyTo",reply);
        ArrayNode mentions=m.putArray("mentions");targets.forEach(mentions::add);
        String taskId=text(p,"taskId");if(taskId.isBlank()&&original!=null)taskId=text(original,"taskId");
        ObjectNode context=taskId.isBlank()?null:get(s,"tasks",taskId);
        if(context!=null&&!tid.equals(text(context,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 任务不属于本团队");
        if(context!=null)m.put("taskId",text(context,"id")).put("runId",text(context,"runId"));
        for(String target:targets) {
            ObjectNode task=createTask(s,tid,target,text,context,p);
            String deliveryId=text(m,"id")+":"+target;
            ObjectNode d=node("id",deliveryId,"messageId",text(m,"id"),"employeeId",target,"taskId",text(task,"id"),"state","queued");
            map(s,"deliveries").set(deliveryId,d);
            ObjectNode job=node("kind","turn","teamId",tid,"employeeId",target,"taskId",text(task,"id"),"runId",text(task,"runId"),"deliveryId",deliveryId);
            enqueue(s,job);task.put("sourceMessageId",text(m,"id"));
            m.put("taskId",text(task,"id")).put("runId",text(task,"runId"));
        }
        return node("id",text(m,"id")).put("recipientCount",targets.size());
    }
}
