package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import static com.gill.web.service.team.TeamData.*;

/** Immutable actual code references and compare-and-set local integration results. */
final class VersionPolicy {
 private VersionPolicy() {}
 static ObjectNode apply(ObjectNode s,TeamActor a,String kind,ObjectNode p) {
  return switch(kind) {
   case "version.record" -> version(s,a,p);
   case "integration.request" -> request(s,a,p);
   case "integration.result" -> result(s,a,p);
   default -> throw new IllegalArgumentException("UNSUPPORTED_ACTION: "+kind);
  };
 }
 private static ObjectNode version(ObjectNode s,TeamActor a,ObjectNode p) {
  ObjectNode task=get(s,"tasks",required(p,"taskId"));TaskAccess.authorize(s,a,task);
  String tid=required(task,"teamId"),commit=required(p,"commit"),base=required(p,"baseRef"),key=required(p,"bundleKey");
  if(!commit.matches("[0-9a-f]{40,64}")||!base.matches("[0-9a-f]{40,64}")||!key.startsWith("teams/"+tid+"/versions/"))
   throw new IllegalArgumentException("INVALID_INPUT: 版本或归档引用无效");
  String project=text(p,"projectId");
  if(!project.isBlank()) {
   ObjectNode pr=get(s,"projects",project);
   if(!tid.equals(text(pr,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 项目跨团队");
   if(text(pr,"baselineCommit").isBlank())pr.put("baselineCommit",base).put("baselineBundle",key)
    .put("revision",pr.path("revision").asInt()+1).put("updatedAt",now());
  }
  ObjectNode n=p.deepCopy();n.put("id",id()).put("teamId",tid).put("createdAt",now()).put("scope","managed-local").put("remotePublished",false);
  map(s,"codeVersions").set(text(n,"id"),n);
  message(s,tid,"system","system","已保存受控工作区代码版本："+commit,"code-version").put("taskId",text(task,"id")).put("versionId",text(n,"id"));
  return node("id",text(n,"id"),"commit",commit);
 }
 private static ObjectNode request(ObjectNode s,TeamActor a,ObjectNode p) {
  ObjectNode task=get(s,"tasks",required(p,"taskId"));TaskAccess.authorize(s,a,task);
  TaskFlow.requireDispatchAllowed(s,task,p);
  ObjectNode project=get(s,"projects",required(p,"projectId"));
  if(!text(project,"teamId").equals(text(task,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 项目跨团队");
  String target=text(project,"targetBranch");if(target.isBlank())target="main";
  for(JsonNode branch:project.path("protectedBranches"))if(branch.asText().equals(target))
   throw new IllegalArgumentException("SCOPE_FORBIDDEN: 目标分支受保护，禁止自主集成");
  if(text(project,"checkCommand").isBlank())throw new IllegalArgumentException("CHECKS_REQUIRED: 请先配置项目检查命令");
  if(!required(p,"expectedTarget").equals(text(project,"baselineCommit")))
   throw new IllegalArgumentException("VERSION_CONFLICT: 目标基线已变化");
  ObjectNode source=null;
  for(JsonNode v:map(s,"codeVersions"))if(text(v,"taskId").equals(text(task,"id"))&&text(v,"commit").equals(required(p,"sourceRef"))&&text(v,"projectId").equals(text(project,"id")))source=(ObjectNode)v;
  if(source==null)throw new IllegalArgumentException("NOT_FOUND: 没有本任务已归档的源版本");
  ObjectNode n=node("id",id(),"teamId",text(task,"teamId"),"taskId",text(task,"id"),"projectId",text(project,"id"),"state","queued");
  n.put("expectedTarget",text(p,"expectedTarget")).put("sourceRef",text(p,"sourceRef")).put("sourceVersionId",text(source,"id"));
  n.put("targetBranch",target);map(s,"integrations").set(text(n,"id"),n);
  n.put("projectRevision",project.path("revision").asInt()).put("checkCommand",text(project,"checkCommand"));
  if(text(get(s,"runs",text(task,"runId")),"state").equals("completed"))get(s,"runs",text(task,"runId")).put("state","active");
  enqueue(s,node("kind","integration","teamId",text(task,"teamId"),"employeeId",text(task,"employeeId"),"taskId",text(task,"id"),"runId",text(task,"runId"),"integrationId",text(n,"id")));
  return node("id",text(n,"id"));
 }
 private static ObjectNode result(ObjectNode s,TeamActor a,ObjectNode p) {
  ObjectNode integration=get(s,"integrations",required(p,"integrationId"));team(a,text(integration,"teamId"));
  ObjectNode project=get(s,"projects",text(integration,"projectId"));
  ObjectNode result=(ObjectNode)p.path("result").deepCopy();String state=text(result,"state");
  integration.set("result",result);integration.put("finishedAt",now());
  if(state.equals("verified")) {
   boolean protectedTarget=false;
   for(JsonNode branch:project.path("protectedBranches"))if(branch.asText().equals(text(integration,"targetBranch")))protectedTarget=true;
   if(!text(integration,"expectedTarget").equals(text(project,"baselineCommit"))||protectedTarget||!text(integration,"targetBranch").equals(text(project,"targetBranch"))||integration.path("projectRevision").asInt()!=project.path("revision").asInt()||!text(integration,"checkCommand").equals(text(project,"checkCommand")))state="target_changed";
   else {
    String commit=required(result,"commit"),key=required(result,"bundleKey");
    if(!commit.matches("[0-9a-f]{40,64}")||!key.startsWith("teams/"+text(integration,"teamId")+"/versions/"))
     throw new IllegalArgumentException("INVALID_INPUT: 集成结果引用无效");
    project.put("baselineCommit",commit).put("baselineBundle",key);
    project.put("revision",project.path("revision").asInt()+1).put("updatedAt",now());
    state="integrated";
   }
  }
  if(state.isBlank())state="failed";integration.put("state",state);
  message(s,text(integration,"teamId"),"system","system","受控项目基线集成结果："+state+"（未推送外部仓库）","integration").put("integrationId",text(integration,"id"));
  if(!state.equals("integrated"))alert(s,text(integration,"teamId"),"集成未完成，已保留实际检查与冲突结果。",text(integration,"id"));
  ObjectNode task=get(s,"tasks",text(integration,"taskId"));boolean all=true;
  for(JsonNode t:map(s,"tasks"))if(text(t,"runId").equals(text(task,"runId"))&&!java.util.Set.of("completed","cancelled").contains(text(t,"state")))all=false;
  for(JsonNode i:map(s,"integrations"))if(text(i,"taskId").equals(text(task,"id"))&&text(i,"state").equals("queued"))all=false;
  if(all&&state.equals("integrated"))get(s,"runs",text(task,"runId")).put("state","completed");
  return node("id",text(integration,"id"),"state",state);
 }
}
