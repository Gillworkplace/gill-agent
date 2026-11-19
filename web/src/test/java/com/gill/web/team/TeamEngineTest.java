package com.gill.web.team;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.gill.web.service.team.TeamEngine;
import com.gill.web.service.team.TeamActor;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TeamEngineTest {
    private final ObjectMapper json = new ObjectMapper();
    private final TeamEngine engine = new TeamEngine();
    private final TeamActor user = new TeamActor("user", "1", null);
    private ObjectNode state = json.createObjectNode();

    private ObjectNode call(String kind, ObjectNode body) { return engine.apply(state, user, kind, body); }
    private ObjectNode body(String... fields) {
        ObjectNode p = json.createObjectNode();
        for (int i=0;i<fields.length;i+=2) p.put(fields[i],fields[i+1]);
        return p;
    }
    private String setup(String name) {
        return call("team.create", body("name",name)).path("id").asText();
    }
    private String employee(String team) {
        String template=call("template.save",body("name","分析员","prompt","根据事实工作")).path("id").asText();
        return call("employee.create",body("teamId",team,"templateId",template,"name","同名员工")).path("id").asText();
    }

    @Test void directedMentionCreatesDurableRecipientWithoutWakingEveryone() {
        String t=setup("研究组"), a=employee(t), b=employee(t);
        ObjectNode p=body("teamId",t,"text","请核查这份结果","requestKey","m1","intent","review");
        p.putArray("mentions").add(b);
        ObjectNode result=engine.apply(state,new TeamActor("employee",a,t),"message.send",p);
        String id=result.path("id").asText();
        assertEquals(1,state.path("deliveries").size());
        assertEquals(b,state.path("deliveries").elements().next().path("employeeId").asText());
        assertEquals(id,state.path("deliveries").elements().next().path("messageId").asText());
        assertEquals(1,state.path("pending").size());
    }
    @Test void explicitEmptyMentionsKeepAReplyAsNotificationOnly() {
        String t=setup("研究"),a=employee(t),b=employee(t);
        ObjectNode original=body("teamId",t,"text","核查已记录");original.putArray("mentions");
        String message=engine.apply(state,new TeamActor("employee",b,t),"message.send",original).path("id").asText();
        ObjectNode reply=body("teamId",t,"text","仅记录收到，不再派工","replyTo",message);reply.putArray("mentions");
        var result=engine.apply(state,new TeamActor("employee",a,t),"message.send",reply);
        assertEquals(0,result.path("recipientCount").asInt());
        assertEquals(0,state.path("deliveries").size());
        assertEquals(0,state.path("pending").size());
    }

    @Test void crossTeamMentionRejectsAtomically() {
        String t=setup("甲"), a=employee(t), other=employee(setup("乙"));
        ObjectNode p=body("teamId",t,"text","越权消息");p.putArray("mentions").add(a).add(other);
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,new TeamActor("employee",a,t),"message.send",p));
        assertEquals(0,state.path("messages").size());
    }

    @Test void employeeCannotCreateEmployeeOrWriteKnowledge() {
        String t=setup("研究"), a=employee(t);
        TeamActor actor=new TeamActor("employee",a,t);
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"knowledge.save",body("title","知识","content","不可写")));
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"employee.create",body("teamId",t)));
    }

    @Test void hierarchyCycleCannotReplaceValidRelationships() {
        String t=setup("研究"), a=employee(t), b=employee(t);
        call("employee.update",body("id",a,"parentId",b,"expectedRevision","1"));
        assertThrows(IllegalArgumentException.class,()->call("employee.update",body("id",b,"parentId",a,"expectedRevision","1")));
        assertEquals("user",state.path("employees").path(b).path("parentId").asText());
    }

    @Test void immutableKnowledgeAndExplicitMounts() {
        String t=setup("研究"), a=employee(t), b=employee(t);
        String k=call("knowledge.save",body("title","口径","content","原始资料")).path("id").asText();
        call("knowledge.mount",body("employeeId",a,"sourceId",k));
        call("knowledge.save",body("id",k,"title","口径","content","新资料","expectedRevision","1"));
        assertEquals(2,state.path("knowledge").path(k).path("versions").size());
        assertEquals("原始资料",state.path("knowledge").path(k).path("versions").get(0).path("content").asText());
        assertEquals(1,state.path("employees").path(a).path("knowledgeIds").size());
        assertEquals(0,state.path("employees").path(b).path("knowledgeIds").size());
    }

    @Test void templateRevisionDoesNotMutateExistingEmployeeSnapshot() {
        String t=setup("研究"), a=employee(t);
        String tpl=state.path("employees").path(a).path("templateId").asText();
        call("template.save",body("id",tpl,"name","新版分析员","prompt","增加出处","expectedRevision","1"));
        assertEquals("根据事实工作",state.path("employees").path(a).path("prompt").asText());
        assertEquals(2,state.path("templates").path(tpl).path("revision").asInt());
    }

    @Test void folderFilesHaveIndependentPathsAndFollowTheAdoptedTemplateRevision() {
        String t=setup("文件夹团队");
        ObjectNode first=body("name","多文件模板");
        first.putArray("files")
            .add(body("path","AGENTS.md","purpose","prompt","key","first").put("size",12))
            .add(body("path","skills/review/SKILL.md","purpose","skill","key","second").put("size",20));
        String template=call("template.save",first).path("id").asText();
        String employee=call("employee.create",body("teamId",t,"templateId",template,"name","文件员工")).path("id").asText();
        String oldTask=call("task.assign",body("employeeId",employee,"goal","固定旧文件")).path("id").asText();
        ObjectNode second=first.deepCopy().put("id",template).put("expectedRevision",1);
        ((ObjectNode)second.path("files").get(0)).put("key","updated");
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,new TeamActor("employee",employee,t),"template.revise",second));
        call("template.save",second);
        String nextTask=call("task.assign",body("employeeId",employee,"goal","采用新文件")).path("id").asText();
        var old=state.path("tasks").path(oldTask).path("employeeSnapshot");
        var next=state.path("tasks").path(nextTask).path("employeeSnapshot");
        assertEquals("first",old.path("files").get(0).path("key").asText());
        assertEquals("updated",next.path("files").get(0).path("key").asText());
        assertEquals("skills/review/SKILL.md",next.path("files").get(1).path("path").asText());
    }

    @Test void teamRoleIsSharedAtTaskCreationAndFrozenAcrossEdits() {
        String team=setup("任务团队"), first=employee(team), second=employee(team);
        String role=call("role.save",body("teamId",team,"name","复核","prompt","复核规则一")).path("id").asText();
        for(String member:new String[]{first,second})
            call("employee.update",body("id",member,"roleId",role,"expectedRevision","1"));
        String oldTask=call("task.assign",body("employeeId",first,"goal","首次复核")).path("id").asText();
        call("role.save",body("id",role,"teamId",team,"name","复核","prompt","复核规则二","expectedRevision","1"));
        for(String member:new String[]{first,second}) {
            String id=call("task.assign",body("employeeId",member,"goal","新工作")).path("id").asText();
            assertEquals("复核规则二",state.path("tasks").path(id).path("roleSnapshot").path("prompt").asText());
        }
        assertEquals("复核规则一",state.path("tasks").path(oldTask).path("roleSnapshot").path("prompt").asText());
        assertEquals(2,engine.skillPreview(state,team,first,"").path("role").path("revision").asInt());
        assertEquals(1,engine.skillPreview(state,team,first,oldTask).path("role").path("revision").asInt());
        assertThrows(IllegalArgumentException.class,()->engine.skillPreview(state,team,second,oldTask));
        assertEquals("根据事实工作",state.path("employees").path(first).path("prompt").asText());
        assertThrows(IllegalArgumentException.class,()->call("role.save",body("teamId",team,"name","复核")));
        String foreign=employee(setup("其他团队"));
        assertThrows(IllegalArgumentException.class,()->call("employee.update",body("id",foreign,"roleId",role,"expectedRevision","1")));
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,new TeamActor("employee",first,team),
            "role.save",body("teamId",team,"name","越权")));
    }
    @Test void retryingTemplateGenerationClearsThePreviousFailure() {
        String draft=call("template.generate",body("text","创建模板")).path("id").asText();
        ObjectNode saved=(ObjectNode)state.path("drafts").path(draft);
        saved.put("busy",false).put("error","previous provider rejection");
        call("template.generate",body("id",draft,"text","资源已恢复，请继续"));
        assertFalse(state.path("drafts").path(draft).has("error"));
        assertTrue(state.path("drafts").path(draft).path("busy").asBoolean());
        assertEquals(2,state.path("drafts").path(draft).path("messages").size());
    }

    @Test void mountedEmployeeCanImproveTemplateWithoutCopyingKnowledge() {
        String t=setup("研究"),a=employee(t);
        String k=call("knowledge.save",body("title","资料","content","只读资料内容")).path("id").asText();
        call("knowledge.mount",body("employeeId",a,"sourceId",k));
        String tpl=state.path("employees").path(a).path("templateId").asText();
        ObjectNode result=engine.apply(state,new TeamActor("employee",a,t),"template.revise",
            body("id",tpl,"name","分析员","prompt","核对事实并说明未验证项","expectedRevision","1"));
        assertEquals(2,result.path("revision").asInt());
        assertEquals("只读资料内容",state.path("knowledge").path(k).path("content").asText());
    }
    @Test void templateCannotCopyMultilineMountedKnowledge() {
        String t=setup("研究"),a=employee(t),content="原始知识第一行\n原始知识第二行";
        String k=call("knowledge.save",body("title","资料","content",content)).path("id").asText();
        call("knowledge.mount",body("employeeId",a,"sourceId",k));
        String tpl=state.path("employees").path(a).path("templateId").asText();
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,new TeamActor("employee",a,t),"template.revise",
            body("id",tpl,"name","分析员","prompt",content,"expectedRevision","1")));
    }

    @Test void unresolvedDecisionCannotBeBypassedByOrdinaryTaskUpdate() {
        String t=setup("研究"),a=employee(t);
        String task=call("task.assign",body("employeeId",a,"goal","分析")).path("id").asText();
        TeamActor actor=new TeamActor("employee",a,t);
        engine.apply(state,actor,"issue.escalate",body("taskId",task,"problem","需用户取舍"));
        assertThrows(IllegalArgumentException.class,()->engine.apply(state,actor,"task.update",body("taskId",task,"state","queued")));
        assertEquals("blocked",state.path("tasks").path(task).path("state").asText());
    }
    @Test void superiorEscalationWaitsWithoutContinuingModelWork() {
        String t=setup("研究"),a=employee(t),superior=employee(t);
        call("employee.update",body("id",a,"parentId",superior,"expectedRevision","1"));
        String task=call("task.assign",body("employeeId",a,"goal","业务取舍")).path("id").asText();
        String decision=engine.apply(state,new TeamActor("employee",a,t),"issue.escalate",body("taskId",task,"problem","缺少策略权重")).path("id").asText();
        String assessment="";
        for(var candidate:state.path("tasks"))if(candidate.path("assessmentDecisionId").asText().equals(decision))assessment=candidate.path("id").asText();
        engine.apply(state,new TeamActor("employee",superior,t),"issue.escalate",body("taskId",assessment,"problem","我也无法决定，需用户取舍"));
        assertEquals("user",state.path("decisions").path(decision).path("handlerId").asText());
        assertEquals("blocked",state.path("tasks").path(assessment).path("state").asText());
        call("decision.respond",body("decisionId",decision,"answer","联调中选择长期价值").put("resolved",true));
        assertEquals("completed",state.path("tasks").path(assessment).path("state").asText());
        assertEquals("queued",state.path("tasks").path(task).path("state").asText());
    }

    @Test void unknownExternalActionPreventsCompletionEvenWithArtifact() {
        String t=setup("研究"),a=employee(t);
        String task=call("task.assign",body("employeeId",a,"goal","分析")).path("id").asText();
        call("artifact.save",body("taskId",task,"title","结果","content","初步结果","unchecked","外部结果未知"));
        ((ObjectNode)state.path("tasks").path(task)).putArray("executedActions").add(body("state","unknown"));
        assertThrows(IllegalArgumentException.class,()->call("run.complete",body("taskId",task)));
    }
    @Test void explicitBudgetGrantResolvesOnlyTheRunsLimitAttention() {
        String t=setup("研究"),a=employee(t);
        String task=call("task.assign",body("employeeId",a,"goal","分析")).path("id").asText();
        String run=state.path("tasks").path(task).path("runId").asText();
        ObjectNode messages=(ObjectNode)state.path("messages");
        messages.set("limit",body("kind","attention","subjectId",run,"status","needs-user"));
        messages.set("unknown",body("kind","attention","subjectId",task,"status","needs-user"));
        call("run.control",body("runId",run,"operation","resume").put("additionalCalls",3));
        assertEquals("responded",state.path("messages").path("limit").path("status").asText());
        assertEquals("needs-user",state.path("messages").path("unknown").path("status").asText());
    }

 @Test void treeBatchValidatesTheWholeRelationSetAtomically() {
  String t=setup("研究"),a=employee(t),b=employee(t);
  ObjectNode p=body("teamId",t);p.putArray("relations")
   .add(body("id",a,"parentId",b).put("expectedRevision",1))
   .add(body("id",b,"parentId","user").put("expectedRevision",1));
  call("team.relations",p);
  assertEquals(b,state.path("employees").path(a).path("parentId").asText());
 }
 @Test void employeeMessagePreservesTaskContextWithoutMentioningSomeone() {
  String t=setup("研究"),a=employee(t);
  String task=call("task.assign",body("employeeId",a,"goal","分析")).path("id").asText();
  var result=engine.apply(state,new TeamActor("employee",a,t),"message.send",body("teamId",t,"taskId",task,"text","阶段进展"));
  assertEquals(task,state.path("messages").path(result.path("id").asText()).path("taskId").asText());
 }

 @Test void codeVersionsAndIntegrationUseExpectedBaseline() {
  String t=setup("研发"),a=employee(t);
  String project=call("project.save",body("teamId",t,"name","产品","targetBranch","main","checkCommand","test -f proof.txt")).path("id").asText();
  String task=call("task.assign",body("employeeId",a,"goal","改进","projectId",project)).path("id").asText();
  String base="a".repeat(40),source="b".repeat(40);
  var version=call("version.record",body("taskId",task,"projectId",project,"commit",source,"baseRef",base,"bundleKey","teams/"+t+"/versions/a.bundle","summary","成果"));
  assertFalse(version.path("id").asText().isEmpty());
  assertEquals(base,state.path("projects").path(project).path("baselineCommit").asText());
  assertThrows(IllegalArgumentException.class,()->call("integration.request",body("taskId",task,"projectId",project,"sourceRef",source,"expectedTarget","c".repeat(40))));
  var request=call("integration.request",body("taskId",task,"projectId",project,"sourceRef",source,"expectedTarget",base));
  assertEquals("queued",state.path("integrations").path(request.path("id").asText()).path("state").asText());
  call("artifact.save",body("taskId",task,"title","结果","content","已归档代码","unchecked","等待集成"));
  assertThrows(IllegalArgumentException.class,()->call("run.complete",body("taskId",task)));
  call("project.save",body("id",project,"name","产品","expectedRevision","2","checkCommand","test -f changed-check.txt"));
  var completion=body("integrationId",request.path("id").asText());
  completion.set("result",body("state","verified","commit","c".repeat(40),"bundleKey","teams/"+t+"/versions/merged.bundle"));
  assertEquals("target_changed",call("integration.result",completion).path("state").asText());
  assertEquals(base,state.path("projects").path(project).path("baselineCommit").asText());
 }

 @Test void agentDerivedTemplateRequiresExplicitCrossTeamSharing() {
  String one=setup("甲"),two=setup("乙");
  String tpl=call("template.save",body("name","通用分析","prompt","初始方法")).path("id").asText();
  String a=call("employee.create",body("teamId",one,"templateId",tpl,"name","甲员工")).path("id").asText();
  String b=call("employee.create",body("teamId",two,"templateId",tpl,"name","乙员工")).path("id").asText();
  engine.apply(state,new TeamActor("employee",a,one),"template.revise",body("id",tpl,"expectedRevision","1","name","通用分析","prompt","团队甲迭代的方法"));
  String task=call("task.assign",body("employeeId",b,"goal","继续分析")).path("id").asText();
  assertEquals("初始方法",state.path("tasks").path(task).path("employeeSnapshot").path("prompt").asText());
  ObjectNode sharing=body("id",tpl).put("expectedRevision",2);sharing.putArray("teamIds").add(two);call("template.share",sharing);
  String after=call("task.assign",body("employeeId",b,"goal","采用明确分享后的方法")).path("id").asText();
  assertEquals("团队甲迭代的方法",state.path("tasks").path(after).path("employeeSnapshot").path("prompt").asText());
 }

 @Test void reassignmentCreatesNewSnapshotAndPreservesOriginalTask() {
  String t=setup("研究"),a=employee(t),b=employee(t);
  String task=call("task.assign",body("employeeId",a,"goal","分析")).path("id").asText();
  ObjectNode result=call("task.update",body("taskId",task,"state","queued","employeeId",b,"reason","调整分工"));
  assertNotEquals(task,result.path("id").asText());
  assertEquals("cancelled",state.path("tasks").path(task).path("state").asText());
  assertEquals(a,state.path("tasks").path(task).path("employeeSnapshot").path("id").asText());
  assertEquals(b,state.path("tasks").path(result.path("id").asText()).path("employeeId").asText());
 }
}
