package com.gill.web.team;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.gill.web.service.team.TeamActor;
import com.gill.web.service.team.TeamEngine;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

/** Regression contracts derived from acceptance F02–F06, independent of model prose. */
class AcceptanceRepairTest {
    final ObjectMapper json=new ObjectMapper();
    final TeamEngine engine=new TeamEngine();
    final ObjectNode state=json.createObjectNode();
    final TeamActor user=new TeamActor("user","1",null);
    ObjectNode body(String... fields) {
        ObjectNode p=json.createObjectNode();
        for(int i=0;i<fields.length;i+=2)p.put(fields[i],fields[i+1]);
        return p;
    }
    ObjectNode call(String kind,ObjectNode p){return engine.apply(state,user,kind,p);}
    String team(){return call("team.create",body("name","验收修复")).path("id").asText();}
    String employee(String team) {
        String tpl=call("template.save",body("name","通用员工","prompt","依据事实工作")).path("id").asText();
        return call("employee.create",body("teamId",team,"templateId",tpl,"name","员工")).path("id").asText();
    }
    String task(String employee){return call("task.assign",body("employeeId",employee,"goal","复核合成资料")).path("id").asText();}
    String escalate(String team,String employee,String task) {
        return engine.apply(state,new TeamActor("employee",employee,team),"issue.escalate",
            body("taskId",task,"problem","需要人工取舍")).path("id").asText();
    }

    @Test void cancelledAndReassignedPlansRejectOldDecisions() {
        String t=team(),a=employee(t),b=employee(t),task=task(a),decision=escalate(t,a,task);
        call("task.update",body("taskId",task,"state","cancelled"));
        assertThrows(IllegalArgumentException.class,()->call("decision.respond",body("decisionId",decision,"answer","旧答复").put("resolved",true)));
        assertEquals("cancelled",state.path("tasks").path(task).path("state").asText());
        assertEquals("superseded",state.path("decisions").path(decision).path("state").asText());
        String other=task(a),old=escalate(t,a,other);
        call("task.update",body("taskId",other,"state","queued","employeeId",b));
        assertThrows(IllegalArgumentException.class,()->call("decision.respond",body("decisionId",old,"answer","旧方案").put("resolved",true)));
    }
    @Test void staleDecisionRevisionDoesNotOverwriteAnotherAssessment() {
        String t=team(),a=employee(t),task=task(a),d=escalate(t,a,task);
        call("decision.respond",body("decisionId",d,"answer","补充依据").put("resolved",false).put("expectedRevision",1));
        assertThrows(IllegalArgumentException.class,()->call("decision.respond",body("decisionId",d,"answer","旧页面").put("resolved",true).put("expectedRevision",1)));
        assertEquals("open",state.path("decisions").path(d).path("state").asText());
        assertEquals("补充依据",state.path("decisions").path(d).path("answer").asText());
    }
    @Test void reviewMustReferenceAnExistingPositiveIntegralVersion() {
        String t=team(),task=task(employee(t));
        String art=call("artifact.save",body("taskId",task,"title","报告","content","A","unchecked","合成数据")).path("id").asText();
        for(int invalid:new int[]{999,0,-1})assertThrows(IllegalArgumentException.class,()->
            call("check.record",body("taskId",task,"artifactId",art,"result","通过").put("subjectRevision",invalid)));
        assertThrows(IllegalArgumentException.class,()->call("check.record",body("taskId",task,"artifactId",art,"result","通过").put("subjectRevision",1.5)));
        call("artifact.save",body("taskId",task,"id",art,"title","报告","content","B","unchecked","新版未验").put("expectedRevision",1));
        call("check.record",body("taskId",task,"artifactId",art,"result","历史A意见").put("subjectRevision",1));
        assertEquals(1,state.path("checks").size());
        assertEquals(1,state.path("checks").elements().next().path("subjectRevision").asInt());
    }
    @Test void employeeArchivesOnlyItsWorkItemProjectWithProvenanceAndCas() {
        String t=team(),a=employee(t),p=call("project.save",body("teamId",t,"name","工作项目")).path("id").asText();
        String task=call("task.assign",body("employeeId",a,"goal","归档","projectId",p)).path("id").asText();
        TeamActor actor=new TeamActor("employee",a,t);
        String id=engine.apply(state,actor,"document.save",body("taskId",task,"projectId",p,"title","分析","content","版本A")).path("id").asText();
        engine.apply(state,actor,"document.save",body("taskId",task,"projectId",p,"id",id,"title","分析","content","版本B").put("expectedRevision",1));
        var doc=state.path("projects").path(p).path("documents").path(id);
        assertEquals(2,doc.path("versions").size());assertEquals(task,doc.path("taskId").asText());
        assertEquals(a,doc.path("versions").get(0).path("authorId").asText());
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"document.save",body("taskId",task,"projectId",p,"id",id,"title","分析","content","过期").put("expectedRevision",1)));
        String other=call("project.save",body("teamId",t,"name","其他项目")).path("id").asText();
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"document.save",body("taskId",task,"projectId",other,"title","越界","content","禁止")));
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"project.save",body("teamId",t,"name","越权配置")));
    }
    @Test void missingOrDisabledSuperiorReportsTheConfigurationFault() {
        String t=team(),a=employee(t),b=employee(t);
        call("employee.update",body("id",a,"parentId",b).put("expectedRevision",1));
        String first=task(a);
        call("employee.update",body("id",b,"lifecycle","disabled").put("expectedRevision",1));
        String d=escalate(t,a,first);
        assertEquals("user",state.path("decisions").path(d).path("handlerId").asText());
        assertTrue(state.path("decisions").path(d).path("configurationError").asText().contains(b));
        assertTrue(state.path("messages").toString().contains("配置异常"));
        ((ObjectNode)state.path("employees")).remove(b);
        String next=task(a),missing=escalate(t,a,next);
        assertTrue(state.path("decisions").path(missing).path("configurationError").asText().contains(b));
    }
    @Test void directedNotificationRetainsRecipientsWithoutCreatingWork() {
        String t=team(),a=employee(t),b=employee(t),source=task(a);
        ((ObjectNode)state).putArray("pending");
        ObjectNode p=body("teamId",t,"taskId",source,"text","复核已结束，无需回复").put("requiresResponse",false);
        p.putArray("mentions").add(b);
        String id=engine.apply(state,new TeamActor("employee",a,t),"message.send",p).path("id").asText();
        assertEquals(b,state.path("messages").path(id).path("mentions").get(0).asText());
        assertEquals(1,state.path("tasks").size());assertEquals(0,state.path("pending").size());
        assertEquals("notified",state.path("deliveries").elements().next().path("state").asText());
    }
    @Test void blockedIssueCannotSpawnMoreWorkButMayRecordANotification() {
        String t=team(),a=employee(t),b=employee(t),source=task(a);escalate(t,a,source);
        TeamActor actor=new TeamActor("employee",a,t);
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"task.assign",body("taskId",source,"employeeId",b,"goal","绕过等待")));
        ObjectNode p=body("teamId",t,"taskId",source,"text","请继续同一问题");p.putArray("mentions").add(b);
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"message.send",p));
        p.put("requiresResponse",false).put("text","仅通知等待人工，不派工");
        assertDoesNotThrow(()->engine.apply(state,actor,"message.send",p));
    }
    @Test void superiorMayDelegateAssessmentButThoseHelpersWaitWhenItEscalates() {
        String t=team(),a=employee(t),boss=employee(t),peer=employee(t);
        call("employee.update",body("id",a,"parentId",boss).put("expectedRevision",1));
        String origin=task(a),decision=escalate(t,a,origin),assessment="";
        for(var candidate:state.path("tasks"))if(candidate.path("assessmentDecisionId").asText().equals(decision))assessment=candidate.path("id").asText();
        TeamActor actor=new TeamActor("employee",boss,t);
        String helper=engine.apply(state,actor,"task.assign",body("taskId",assessment,"employeeId",peer,"goal","补齐评估依据")).path("id").asText();
        ObjectNode p=body("taskId",helper,"employeeId",boss,"goal","交回评估依据");
        assertDoesNotThrow(()->engine.apply(state,new TeamActor("employee",peer,t),"task.assign",p));
        engine.apply(state,actor,"issue.escalate",body("taskId",assessment,"problem","仍需用户决定"));
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,new TeamActor("employee",peer,t),"task.assign",p));
    }
    @Test void humanMayContinueACompletedConversationWithoutReopeningTheOldTask() {
        String t=team(),a=employee(t),source=task(a);
        call("artifact.save",body("taskId",source,"title","结果","content","已完成","unchecked","合成样本"));
        call("run.complete",body("taskId",source));
        String message="";
        for(var m:state.path("messages"))if(m.path("kind").asText().equals("task-completed"))message=m.path("id").asText();
        ObjectNode p=body("teamId",t,"replyTo",message,"text","基于已完成结果补充下一项分析").put("requiresResponse",true);p.putArray("mentions");
        assertDoesNotThrow(()->call("message.send",p));
        assertEquals("completed",state.path("tasks").path(source).path("state").asText());
        assertEquals(2,state.path("tasks").size());
        assertEquals("active",state.path("runs").elements().next().path("state").asText());
    }
}
