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
  String template=command("template.save",body("name","employee","prompt","work carefully")).path("id").asText();
  String employee=command("employee.create",body("name","one","teamId",team,"templateId",template)).path("id").asText();
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
  String template=command("template.save",body("name","employee","prompt","work")).path("id").asText();
  String employee=command("employee.create",body("name","one","teamId",team,"templateId",template)).path("id").asText();
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
 }
}
