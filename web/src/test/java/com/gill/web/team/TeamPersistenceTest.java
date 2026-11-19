package com.gill.web.team;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.gill.web.service.TeamService;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import javax.sql.DataSource;
import java.util.*;
import java.util.concurrent.*;
import static org.junit.jupiter.api.Assertions.*;

/** Opt-in real PostgreSQL integration; isolated test database is required. */
@SpringBootTest
@EnabledIfEnvironmentVariable(named="GILL_TEAM_DB_TEST",matches="1")
class TeamPersistenceTest {
 @Autowired TeamService service;
 @Autowired ObjectMapper json;
 @Autowired DataSource dataSource;
 long uid;
 @BeforeEach void user() throws Exception {
  try(var c=dataSource.getConnection();var p=c.prepareStatement("INSERT INTO users(username,password_hash) VALUES (?,?) RETURNING id")) {
   p.setString(1,"team-it-"+UUID.randomUUID().toString().substring(0,8));p.setString(2,"unused-test-hash");
   var r=p.executeQuery();r.next();uid=r.getLong(1);
  }
 }
 @AfterEach void cleanup() throws Exception {
  try(var c=dataSource.getConnection()) {
   for(String sql:List.of(
    "DELETE FROM team_actions WHERE job_id IN(SELECT id FROM team_jobs WHERE owner_user_id=?)",
    "DELETE FROM team_jobs WHERE owner_user_id=?","DELETE FROM team_events WHERE owner_user_id=?",
    "DELETE FROM team_requests WHERE owner_user_id=?","DELETE FROM team_workspaces WHERE owner_user_id=?","DELETE FROM users WHERE id=?")) {
    try(var p=c.prepareStatement(sql)){p.setLong(1,uid);p.executeUpdate();}
   }
  }
 }
 ObjectNode body(String... fields){ObjectNode n=json.createObjectNode();for(int i=0;i<fields.length;i+=2)n.put(fields[i],fields[i+1]);return n;}
 ObjectNode command(String kind,ObjectNode p){return service.command(uid,UUID.randomUUID().toString(),kind,p);}
 @Test void cliClaimIsScopedAndKeepsTheOriginalRunnerWhenResumed() throws Exception {
  String team=command("team.create",body("name","local team")).path("id").asText();
  String employee=command("employee.create",body("name","local employee","teamId",team,"prompt","按要求协作")).path("id").asText();
  String project=command("project.save",body("teamId",team,"name","local project")).path("id").asText();
  String task=command("task.assign",body("employeeId",employee,"projectId",project,"goal","create local artifact")).path("id").asText();
  String runner="a".repeat(24);
  assertNull(service.claim("template-slot","templates",0,"",""));
  assertNull(service.claim("another-account","cli",uid+1,project,runner));
  assertNull(service.claim("without-project","cli",uid,"",runner));
  var job=service.claim("local-slot","cli",uid,project,runner);
  assertNotNull(job);
  String id=job.get("id").toString();
  var identity=body("workerId","local-slot").put("fence",((Number)job.get("fence")).longValue());
  var context=service.worker(id,"context",identity);
  assertEquals(task,context.path("task").path("id").asText());
  assertEquals("cli",context.path("executor").asText());
  service.worker(id,"sandbox",identity.deepCopy().put("sandboxId","cli-"+runner+"-"+id));
  try(var c=dataSource.getConnection();var p=c.prepareStatement("UPDATE team_jobs SET lease_until=now()-interval '1 second' WHERE id=?::uuid")) {
   p.setString(1,id);p.executeUpdate();
  }
  assertNull(service.claim("cloud-slot"));
  assertNull(service.claim("different-directory","cli",uid,project,"b".repeat(24)));
  assertEquals(id,service.claim("resumed-local-slot","cli",uid,project,runner).get("id"));
 }
 @Test void durableIdempotencyRejectsDifferentPayloadAndKeepsSingleTeam() {
  var p=body("name","persistent team");
  var first=service.command(uid,"same-key","team.create",p);
  assertEquals(first,service.command(uid,"same-key","team.create",p));
  assertEquals(1,service.read(uid).path("teams").size());
  assertThrows(IllegalArgumentException.class,()->service.command(uid,"same-key","team.create",body("name","changed")));
  var ordered=body("name","order-independent","description","same content");
  var reordered=body("description","same content","name","order-independent");
  var saved=service.command(uid,"order-key","team.create",ordered);
  assertEquals(saved,service.command(uid,"order-key","team.create",reordered));
 }
 @Test void concurrentDefinitionUpdatesCannotBothAdoptTheSameRevision() throws Exception {
  String team=command("team.create",body("name","initial")).path("id").asText();
  var start=new CyclicBarrier(2);var pool=Executors.newFixedThreadPool(2);
  try {
   List<Future<Boolean>> attempts=new ArrayList<>();
   for(String name:List.of("first","second"))attempts.add(pool.submit(()->{
    start.await();
    try{command("team.update",body("id",team,"name",name,"expectedRevision","1"));return true;}
    catch(IllegalArgumentException conflict){assertTrue(conflict.getMessage().startsWith("VERSION_CONFLICT"));return false;}
   }));
   int successes=0;for(var attempt:attempts)if(attempt.get(10,TimeUnit.SECONDS))successes++;
   assertEquals(1,successes);assertEquals(2,service.read(uid).path("teams").path(team).path("revision").asInt());
  } finally {pool.shutdownNow();}
 }
 @Test void claimFenceAndActionReceiptsAreDurable() {
  String team=command("team.create",body("name","worker team")).path("id").asText();
  String employee=command("employee.create",body("name","one","teamId",team,"prompt","按要求协作")).path("id").asText();
  var msg=body("teamId",team,"text","produce artifact");msg.putArray("mentions").add(employee);
  command("message.send",msg);
  var job=service.claim("integration-test");
  assertNotNull(job);
  String id=job.get("id").toString();long fence=((Number)job.get("fence")).longValue();
  ObjectNode identity=body("workerId","integration-test").put("fence",fence);
  var context=service.worker(id,"context",identity);
  assertEquals(employee,context.path("employee").path("id").asText());
  String knowledge=command("knowledge.save",body("title","source","content","read before unmount")).path("id").asText();
  command("knowledge.mount",body("employeeId",employee,"sourceId",knowledge));
  assertEquals(1,service.worker(id,"context",identity).path("knowledge").size());
  command("knowledge.unmount",body("employeeId",employee,"sourceId",knowledge));
  var afterUnmount=service.worker(id,"context",identity);
  assertEquals(0,afterUnmount.path("knowledge").size());
  assertEquals("read before unmount",afterUnmount.path("retainedKnowledge").path(knowledge).path("content").asText());
  var wrong=identity.deepCopy().put("fence",fence+1);
  assertThrows(IllegalArgumentException.class,()->service.worker(id,"heartbeat",wrong));
  var action=identity.deepCopy().put("requestKey","call-one").put("kind","shell");
  action.set("input",body("command","printf integration-test"));
  String actionId=service.worker(id,"action",action).path("id").asText();
  assertEquals(actionId,service.worker(id,"action",action).path("id").asText());
  var receipt=identity.deepCopy().put("requestKey","call-one").put("state","succeeded");
  receipt.set("result",body("stdout","integration-test").put("exitCode",0));
  service.worker(id,"action-result",receipt);
  assertEquals("succeeded",service.worker(id,"action",action).path("state").asText());
  assertNotNull(service.read(uid).path("tasks").elements().next().path("executedActions").get(0));
 }
 @Test void uncertainExecutionRequiresEvidenceAndLateResultsNeverApply() {
  String team=command("team.create",body("name","reconciliation team")).path("id").asText();
  String employee=command("employee.create",body("name","one","teamId",team,"prompt","按要求协作")).path("id").asText();
  String task=command("task.assign",body("employeeId",employee,"goal","work")).path("id").asText();
  var job=service.claim("reconciliation-test");String id=job.get("id").toString();
  ObjectNode identity=body("workerId","reconciliation-test").put("fence",((Number)job.get("fence")).longValue());
  var action=identity.deepCopy().put("requestKey","uncertain").put("kind","shell");action.set("input",body("command","external request"));
  service.worker(id,"action",action);
  assertThrows(IllegalArgumentException.class,()->command("task.update",body("taskId",task,"state","queued")));
  var finish=identity.deepCopy().put("state","failed");finish.set("result",body("error","connection lost"));
  assertEquals("needs_reconciliation",service.worker(id,"finish",finish).path("state").asText());
  assertThrows(IllegalArgumentException.class,()->command("execution.reconcile",body("executionId",id,"resolution","failed","evidence","checked")));
  command("execution.reconcile",body("executionId",id,"resolution","failed","evidence","actual log inspected; request ended").put("executionStopped",true));
  assertEquals("paused",service.read(uid).path("tasks").path(task).path("state").asText());
  assertThrows(IllegalArgumentException.class,()->service.worker(id,"heartbeat",identity));
  var late=identity.deepCopy().put("requestKey","uncertain");late.set("result",body("stdout","late actual result"));
  assertEquals("recorded-not-applied",service.worker(id,"late-result",late).path("state").asText());
  var retained=service.read(uid).path("tasks").path(task);
  assertEquals("paused",retained.path("state").asText());assertEquals(1,retained.path("lateReports").size());
  command("task.update",body("taskId",task,"state","queued"));
  assertEquals("queued",service.read(uid).path("tasks").path(task).path("state").asText());
  var resumed=service.claim("verified-resume");
  assertNotNull(resumed,"explicit resume must schedule work after the unknown result was reconciled");
  assertEquals(task,service.worker(resumed.get("id").toString(),"context",identity(resumed,"verified-resume")).path("taskId").asText());
 }

 @Test void expiredLeaseShowsUnknownInTheRunAndTheAffectedTask() throws Exception {
  String team=command("team.create",body("name","expired lease")).path("id").asText(),employee=employeeForRepair(team);
  String task=command("task.assign",body("employeeId",employee,"goal","inspect actual result")).path("id").asText();
  String worker="lost-receipt";
  var job=service.claim(worker);
  String id=job.get("id").toString();
  var input=identity(job,worker).put("requestKey","issued").put("kind","shell");
  input.set("input",body("command","isolated fixture"));
  service.worker(id,"action",input);
  String run=service.read(uid).path("tasks").path(task).path("runId").asText();
  try(var connection=dataSource.getConnection();var statement=connection.prepareStatement(
    "UPDATE team_jobs SET lease_until=now()-interval '1 second' WHERE id=?::uuid AND owner_user_id=?")) {
   statement.setString(1,id);statement.setLong(2,uid);assertEquals(1,statement.executeUpdate());
  }
  assertEquals("unknown",service.read(uid).path("runs").path(run).path("state").asText());
  assertNull(service.claim("another-slot"));
  var view=service.read(uid);
  assertEquals("needs_reconciliation",view.path("tasks").path(task).path("state").asText());
  assertEquals("needs_reconciliation",view.path("runs").path(run).path("state").asText());
  command("execution.reconcile",body("executionId",id,"resolution","succeeded","evidence","verified the original instance").put("executionStopped",true));
  assertEquals("paused",service.read(uid).path("runs").path(run).path("state").asText());
  assertNull(service.claim("another-slot"));
 }

 @Test void aVerifiedIntegrationPreservesTheCompletedSourceTask() {
  String team=command("team.create",body("name","release")).path("id").asText(),employee=employeeForRepair(team);
  String project=command("project.save",body("teamId",team,"name","blank project","checkCommand","test -f proof.txt")).path("id").asText();
  String task=command("task.assign",body("employeeId",employee,"projectId",project,"goal","create proof")).path("id").asText();
  String base="a".repeat(40),source="b".repeat(40),merged="c".repeat(40);
  String worker="git-state";
  var turn=service.claim(worker);
  workerCommand(turn,worker,"version.record",body("projectId",project,"commit",source,"baseRef",base,"bundleKey","teams/"+team+"/versions/source"));
  workerCommand(turn,worker,"artifact.save",body("title","proof","content","done","unchecked","synthetic"));
  workerCommand(turn,worker,"run.complete",body());
  finish(turn,worker);
  String integration=command("integration.request",body("taskId",task,"projectId",project,"sourceRef",source,"expectedTarget",base)).path("id").asText();
  assertThrows(IllegalArgumentException.class,()->command("integration.result",body("integrationId",integration)));
  var job=service.claim(worker);
  ObjectNode action=identity(job,worker).put("requestKey","git-action").put("kind","git.integrate");
  action.set("input",body("source",source));
  service.worker(job.get("id").toString(),"action",action);
  var duplicate=assertThrows(IllegalArgumentException.class,()->command("integration.request",
    body("taskId",task,"projectId",project,"sourceRef",source,"expectedTarget",base)));
  assertTrue(duplicate.getMessage().startsWith("ACTION_RESULT_UNKNOWN"));
  var outcome=body("state","verified","commit",merged,"bundleKey","teams/"+team+"/versions/merged");
  var receipt=identity(job,worker).put("requestKey","git-action").put("state","succeeded");
  receipt.set("result",outcome);
  service.worker(job.get("id").toString(),"action-result",receipt);
  var result=body("integrationId",integration);
  result.set("result",outcome);
  workerCommand(job,worker,"integration.result",result);
  finish(job,worker);
  var view=service.read(uid);
  assertEquals("integrated",view.path("integrations").path(integration).path("state").asText());
  assertEquals("completed",view.path("tasks").path(task).path("state").asText());
  String run=view.path("tasks").path(task).path("runId").asText();
  assertEquals("completed",view.path("runs").path(run).path("state").asText());
 }

 private ObjectNode workerCommand(Map<String,Object> job,String worker,String kind,ObjectNode payload) {
  var request=identity(job,worker).put("requestKey",UUID.randomUUID().toString()).put("kind",kind);
  request.set("payload",payload);
  return service.worker(job.get("id").toString(),"command",request);
 }

 String employeeForRepair(String team) {
  return command("employee.create",body("name","repair","teamId",team,"prompt","按要求协作")).path("id").asText();
 }
 ObjectNode identity(Map<String,Object> job,String worker) {
  return body("workerId",worker).put("fence",((Number)job.get("fence")).longValue());
 }
 void finish(Map<String,Object> job,String worker) {
  ObjectNode p=identity(job,worker).put("state","done");p.set("result",json.createObjectNode());
  service.worker(job.get("id").toString(),"finish",p);
 }
 @Test void answeredDuringPauseResumesExactlyOnceAndRejectsTheOldGeneration() {
  String team=command("team.create",body("name","repair")).path("id").asText(),employee=employeeForRepair(team);
  String task=command("task.assign",body("employeeId",employee,"goal","needs decision")).path("id").asText();
  var job=service.claim("repair-test");String id=job.get("id").toString();
  ObjectNode op=identity(job,"repair-test").put("kind","issue.escalate").put("requestKey","escalate");
  op.set("payload",body("problem","need user"));
  String decision=service.worker(id,"command",op).path("id").asText();finish(job,"repair-test");
  String run=service.read(uid).path("tasks").path(task).path("runId").asText();
  command("run.control",body("runId",run,"operation","pause"));
  command("decision.respond",body("decisionId",decision,"answer","choose A").put("resolved",true));
  assertNull(service.claim("repair-test"));
  command("run.control",body("runId",run,"operation","resume"));
  command("run.control",body("runId",run,"operation","resume"));
  var resumed=service.claim("repair-test");assertNotNull(resumed,"answered task must become executable after explicit resume");
  assertNull(service.claim("another-slot"),"same task must not be claimed twice");
  assertEquals(task,service.worker(resumed.get("id").toString(),"context",identity(resumed,"repair-test")).path("taskId").asText());
 }
 @Test void sameIssueDependenciesWaitWithoutBlockingIndependentSiblingsOrTheAssessment() {
  String team=command("team.create",body("name","dependency repair")).path("id").asText(),a=employeeForRepair(team),b=employeeForRepair(team);
  String root=command("task.assign",body("employeeId",a,"goal","root")).path("id").asText();
  var rootJob=service.claim("root-slot");
  String child=command("task.assign",body("taskId",root,"employeeId",b,"goal","dependent")).path("id").asText();
  ObjectNode independent=body("taskId",root,"employeeId",b,"goal","independent");independent.putArray("dependsOnTaskIds");
  String sibling=command("task.assign",independent).path("id").asText();
  var childJob=service.claim("child-slot");var siblingJob=service.claim("sibling-slot");
  String decision=command("issue.escalate",body("taskId",root,"problem","human choice")).path("id").asText();
  ObjectNode action=identity(childJob,"child-slot").put("requestKey","waited-model").put("kind","model");action.set("input",body("turn","1"));
  assertEquals("paused",service.worker(childJob.get("id").toString(),"action",action).path("state").asText());
  ObjectNode other=identity(siblingJob,"sibling-slot").put("requestKey","independent-model").put("kind","model");other.set("input",body("turn","1"));
  assertEquals("dispatched",service.worker(siblingJob.get("id").toString(),"action",other).path("state").asText());
  ObjectNode receipt=identity(siblingJob,"sibling-slot").put("requestKey","independent-model").put("state","succeeded");receipt.set("result",body("usage","synthetic receipt; no real model"));
  service.worker(siblingJob.get("id").toString(),"action-result",receipt);
  finish(rootJob,"root-slot");finish(childJob,"child-slot");finish(siblingJob,"sibling-slot");
  assertEquals("blocked",service.read(uid).path("tasks").path(child).path("state").asText());
  command("decision.respond",body("decisionId",decision,"answer","go ahead").put("resolved",true));
  assertNotNull(service.claim("after-answer"));
  assertFalse(service.read(uid).path("tasks").path(sibling).path("state").asText().equals("blocked"));
 }
 @Test void answeredWhileOldWorkerRunsFencesNewDispatchAndPreservesItsReceipt() {
  String team=command("team.create",body("name","generation repair")).path("id").asText(),a=employeeForRepair(team);
  String task=command("task.assign",body("employeeId",a,"goal","wait then resume")).path("id").asText();
  var old=service.claim("old-worker");String id=old.get("id").toString();
  ObjectNode intent=identity(old,"old-worker").put("requestKey","in-flight").put("kind","model");intent.set("input",body("turn","1"));
  service.worker(id,"action",intent);
  String decision=command("issue.escalate",body("taskId",task,"problem","need user")).path("id").asText();
  command("decision.respond",body("decisionId",decision,"answer","choose A").put("resolved",true));
  assertEquals("paused",service.worker(id,"heartbeat",identity(old,"old-worker")).path("state").asText());
  ObjectNode next=intent.deepCopy().put("requestKey","stale-next");
  assertEquals("paused",service.worker(id,"action",next).path("state").asText());
  assertNull(service.claim("new-worker"));
  ObjectNode receipt=identity(old,"old-worker").put("requestKey","in-flight").put("state","succeeded");receipt.set("result",body("usage","retained old request receipt"));
  service.worker(id,"action-result",receipt);
  assertNull(service.claim("new-worker"),"one task must not run in two slots at once");
  finish(old,"old-worker");
  assertEquals("queued",service.read(uid).path("tasks").path(task).path("state").asText());
  var resumed=service.claim("new-worker");assertNotNull(resumed);
  assertEquals("choose A",service.worker(resumed.get("id").toString(),"context",identity(resumed,"new-worker")).path("task").path("decisionAnswer").asText());
  assertEquals(1,service.readExecution(uid,id).path("actions").size());
 }
}
