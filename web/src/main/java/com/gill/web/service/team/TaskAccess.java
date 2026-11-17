package com.gill.web.service.team;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.HashSet;
import java.util.Set;
import static com.gill.web.service.team.TeamData.*;

/** Shared lower-level authorization against a task's adopted organization snapshot. */
final class TaskAccess {
 private TaskAccess() {}
 static String parent(ObjectNode s,ObjectNode task,String employee) {
  JsonNode fixed=task.path("teamSnapshot").path("organization").get(employee);
  return fixed==null?text(get(s,"employees",employee),"parentId"):fixed.asText();
 }
 static void authorize(ObjectNode s,TeamActor actor,ObjectNode task) {
  team(actor,text(task,"teamId"));if(actor.human())return;
  String owner=text(task,"employeeId");Set<String> seen=new HashSet<>();
  while(!owner.equals("user")&&seen.add(owner)) {
   if(owner.equals(actor.id()))return;
   owner=parent(s,task,owner);
  }
  throw new IllegalArgumentException("SCOPE_FORBIDDEN: 仅负责人或其上级可调整任务");
 }
}
