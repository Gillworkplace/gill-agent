package com.gill.web.service.team;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import static com.gill.web.service.team.TeamData.*;
/** Shared lower-level task snapshot factory and template three-way adoption. */
final class TaskAdoption {
 private TaskAdoption() {}
    static ObjectNode createTask(ObjectNode s,String tid,String employee,String goal,ObjectNode parent,ObjectNode p) {
        ObjectNode e=get(s,"employees",employee);adopt(s,e);
        String runId=parent==null?id():required(parent,"runId");
        if(parent==null) {
            ObjectNode run=node("id",runId,"teamId",tid,"goal",goal,"state","active","createdAt",now());
            run.put("manualPaused",false).put("controlRevision",0).put("calls",0);
            run.set("limits",get(s,"teams",tid).path("limits").deepCopy());map(s,"runs").set(runId,run);
            String wi=id();ObjectNode work=node("id",wi,"teamId",tid,"runId",runId,"goal",goal,"projectId",text(p,"projectId"),"state","active");
            String projectId=text(p,"projectId");
            if(!projectId.isBlank()){ObjectNode project=get(s,"projects",projectId);if(!tid.equals(text(project,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 项目跨团队");work.set("projectSnapshot",project.deepCopy());}
            map(s,"workItems").set(wi,work);run.put("workItemId",wi);
        }
        ObjectNode run=get(s,"runs",runId);
        if(!tid.equals(text(run,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 跨团队运行");
        ObjectNode task=node("id",id(),"teamId",tid,"employeeId",employee,"runId",runId,"goal",goal,"state","queued","createdAt",now());
        task.put("revision",1).put("parentTaskId",parent==null?"":text(parent,"id")).put("workItemId",text(run,"workItemId"));
        task.put("generation",1);
        ArrayNode dependencies=task.putArray("dependsOnTaskIds");
        if(p.has("dependsOnTaskIds")) {
            if(!p.path("dependsOnTaskIds").isArray())throw new IllegalArgumentException("INVALID_INPUT: dependsOnTaskIds需为数组");
            for(JsonNode id:p.path("dependsOnTaskIds")) {
                ObjectNode dependency=get(s,"tasks",id.asText());
                if(!runId.equals(text(dependency,"runId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 依赖任务必须属于同一工作运行");
                dependencies.add(id.asText());
            }
        } else if(parent!=null)dependencies.add(text(parent,"id"));
        task.set("employeeSnapshot",e.deepCopy());ObjectNode teamSnapshot=get(s,"teams",tid).deepCopy();
        ObjectNode organization=teamSnapshot.putObject("organization");
        for(JsonNode member:map(s,"employees"))if(tid.equals(text(member,"teamId")))organization.put(text(member,"id"),text(member,"parentId"));
        task.set("teamSnapshot",teamSnapshot);
        map(s,"tasks").set(text(task,"id"),task);
        if(text(run,"state").equals("completed"))run.put("state","active");
        return task;
    }
    private static void adopt(ObjectNode s,ObjectNode e) {
        ObjectNode tpl=get(s,"templates",required(e,"templateId"));
        int latest=tpl.path("revision").asInt();
        if(latest==e.path("templateRevision").asInt())return;
        String origin=text(tpl,"originTeamId"),tid=text(e,"teamId");boolean shared=origin.isBlank()||origin.equals(tid);
        for(JsonNode target:tpl.path("authorizedTeamIds"))if(target.asText().equals(tid))shared=true;
        if(!shared){if(e.path("sharingPendingRevision").asInt()!=latest)alert(s,tid,"模板新版本来自其他团队，等待你明确授权；保留员工当前版本。",text(e,"id"));e.put("sharingPendingRevision",latest);return;}
        String old=text(e,"prompt"),base=text(e,"basePrompt"),next=text(tpl,"prompt");
        boolean promptConflict=!old.equals(base)&&!next.equals(base)&&!old.equals(next);
        JsonNode skills=e.path("skills"),baseSkills=e.path("baseSkills"),nextSkills=tpl.path("skills");
        boolean skillConflict=!skills.equals(baseSkills)&&!nextSkills.equals(baseSkills)&&!skills.equals(nextSkills);
        if(promptConflict||skillConflict) {
            if(e.path("adoptionConflictRevision").asInt()!=latest)
                alert(s,text(e,"teamId"),"模板采用存在冲突，保留员工当前工作版本，请评估后调整。",text(e,"id"));
            e.put("adoptionConflictRevision",latest);return;
        }
        if(old.equals(base))e.put("prompt",next);
        if(skills.equals(baseSkills))e.set("skills",nextSkills.deepCopy());
        e.put("basePrompt",next).set("baseSkills",nextSkills.deepCopy());e.put("templateRevision",latest);
        save(s,"employees",e,new TeamActor("system","template-adoption",text(e,"teamId")));
    }
}
