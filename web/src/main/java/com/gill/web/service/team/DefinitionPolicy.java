package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.*;
import static com.gill.web.service.team.TeamData.*;

/** Definition revisions and explicit employee membership/mounts. */
final class DefinitionPolicy {
    private DefinitionPolicy() {}
    static ObjectNode apply(ObjectNode s,TeamActor a,String kind,ObjectNode p) {
        return switch(kind) {
            case "team.relations" -> relations(s,a,p);
            case "team.create","team.update" -> saveTeam(s,a,p);
            case "role.save" -> saveRole(s,a,p);
            case "orgTemplate.save" -> OrganizationTemplates.saveTemplate(s,a,p);
            case "orgTemplate.delete","template.delete","team.delete","role.delete","employee.delete",
                 "knowledge.delete","project.delete","document.delete" -> ResourceRemoval.remove(s,a,kind,p);
            case "template.save","template.revise","template.share","template.generate" ->
                throw new IllegalArgumentException("INVALID_STATE: 历史员工模板仅供查看和转换");
            case "employee.create","employee.update" -> saveEmployee(s,a,p);
            case "knowledge.save" -> saveKnowledge(s,a,p);
            case "knowledge.mount","knowledge.unmount" -> mount(s,a,p,kind.endsWith(".mount"));
            case "project.save","document.save","workspace.configure" -> project(s,a,p,kind);
            case "draft.generated" -> finishLegacyDraft(s,a,p);
            default -> throw new IllegalArgumentException("UNSUPPORTED_ACTION: "+kind);
        };
    }
    private static ObjectNode relations(ObjectNode s,TeamActor a,ObjectNode p) {
        human(a);String tid=required(p,"teamId");get(s,"teams",tid);
        ObjectNode shadow=s.deepCopy();Set<String> supplied=new HashSet<>(),actual=new HashSet<>();
        for(JsonNode e:map(s,"employees"))if(tid.equals(text(e,"teamId")))actual.add(text(e,"id"));
        for(JsonNode relation:p.path("relations")) {
            String id=required(relation,"id");ObjectNode e=get(shadow,"employees",id);
            if(!tid.equals(text(e,"teamId"))||!supplied.add(id))throw new IllegalArgumentException("INVALID_RELATION: 员工范围或重复节点无效");
            revision(e,relation);e.put("parentId",required(relation,"parentId"));
        }
        if(!supplied.equals(actual))throw new IllegalArgumentException("VERSION_CONFLICT: 成员发生变化，请重新读取");
        for(String id:supplied)validateParent(shadow,get(shadow,"employees",id));
        ObjectNode organization=node();
        for(String id:supplied){ObjectNode e=get(shadow,"employees",id);save(s,"employees",e,a);organization.put(id,text(e,"parentId"));}
        ObjectNode team=get(s,"teams",tid).deepCopy();team.set("organization",organization);
        return save(s,"teams",team,a);
    }
    private static ObjectNode saveTeam(ObjectNode s,TeamActor a,ObjectNode p) {
        human(a);String id=text(p,"id");ObjectNode n=id.isEmpty()?node("id",id()):get(s,"teams",id).deepCopy();
        if(!id.isEmpty())revision(n,p);
        ObjectNode template=id.isEmpty()&&p.hasNonNull("orgTemplateId")?OrganizationTemplates.select(s,"team",p):null;
        if(template!=null){
            OrganizationTemplates.copyRoleFields(n,template);
            n.put("description",text(template,"description"));
        }
        n.put("name",required(p,"name"));
        for(String f:List.of("description","prompt","receiverId"))if(p.has(f))n.put(f,text(p,f));
        savePromptFiles(n,p);
        if(p.has("limits")){
            int calls=p.path("limits").path("maxRounds").asInt(25),seconds=p.path("limits").path("maxSeconds").asInt(900);
            if(calls<1||calls>1000||seconds<1||seconds>86400)throw new IllegalArgumentException("INVALID_INPUT: 调用上限需为1至1000，运行时长为1至86400秒");
            n.set("limits",p.get("limits").deepCopy());
        }
        ObjectNode saved=save(s,"teams",n,a);
        if(template!=null)OrganizationTemplates.createRoles(s,a,text(n,"id"),template);
        return saved;
    }
    private static ObjectNode saveRole(ObjectNode s,TeamActor actor,ObjectNode p) {
        human(actor);
        String tid=required(p,"teamId"), roleId=text(p,"id");
        get(s,"teams",tid);
        ObjectNode role=roleId.isBlank()?node("id",id(),"teamId",tid):get(s,"teamRoles",roleId).deepCopy();
        if(!tid.equals(text(role,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 角色属于其他团队");
        if(!roleId.isBlank())revision(role,p);
        String name=required(p,"name").strip();
        if(name.length()>30)throw new IllegalArgumentException("INVALID_INPUT: 角色名称最多30字");
        for(JsonNode other:map(s,"teamRoles")) {
            if(tid.equals(text(other,"teamId"))&&!text(role,"id").equals(text(other,"id"))&&name.equalsIgnoreCase(text(other,"name")))
                throw new IllegalArgumentException("INVALID_INPUT: 本团队已有同名角色");
        }
        if(roleId.isBlank()&&p.hasNonNull("orgTemplateId"))
            OrganizationTemplates.copyRoleFields(role,OrganizationTemplates.select(s,"role",p));
        role.put("name",name);
        if(p.has("prompt"))role.put("prompt",text(p,"prompt"));
        savePromptFiles(role,p);
        return save(s,"teamRoles",role,actor);
    }
    private static ObjectNode saveEmployee(ObjectNode s,TeamActor a,ObjectNode p) {
        human(a);String id=text(p,"id");boolean fresh=id.isEmpty();
        ObjectNode n=fresh?node("id",id(),"teamId",required(p,"teamId")):get(s,"employees",id).deepCopy();
        String tid=required(n,"teamId");get(s,"teams",tid);
        if(!fresh)revision(n,p);
        if(p.has("teamId")&&!tid.equals(text(p,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工不能跨团队移动");
        if(p.has("templateId")||p.has("orgTemplateId"))
            throw new IllegalArgumentException("INVALID_INPUT: 员工直接创建，请配置个人设定");
        if(fresh) {
            n.putArray("knowledgeIds");
            n.putArray("skills");
            n.put("parentId","user").put("status","idle").put("prompt","");
        }
        for(String f:List.of("name","role","prompt","personality","parentId","lifecycle"))if(p.has(f))n.put(f,text(p,f));
        if(p.has("roleId")) {
            if(!p.path("roleId").isTextual())throw new IllegalArgumentException("INVALID_INPUT: roleId 必须为字符串");
            String roleId=text(p,"roleId");
            if(!roleId.isBlank()&&!tid.equals(text(get(s,"teamRoles",roleId),"teamId")))
                throw new IllegalArgumentException("SCOPE_FORBIDDEN: 仅可关联本团队角色");
            n.put("roleId",roleId);
        }
        savePromptFiles(n,p);
        if(p.has("skills"))n.set("skills",p.path("skills").deepCopy());
        if(text(n,"name").isBlank())throw new IllegalArgumentException("INVALID_INPUT: 员工姓名不能为空");
        validateParent(s,n);
        ObjectNode result=save(s,"employees",n,a);
        ObjectNode t=get(s,"teams",tid);
        if(text(t,"receiverId").isBlank())t.put("receiverId",text(n,"id"));
        return result;
    }
    private static void savePromptFiles(ObjectNode definition,ObjectNode payload) {
        if(!payload.has("promptFiles"))return;
        TemplateFiles.validateManifest(payload.path("promptFiles"));
        definition.set("promptFiles",payload.get("promptFiles").deepCopy());
    }
    private static void validateParent(ObjectNode s,ObjectNode n) {
        String id=text(n,"id"),parent=text(n,"parentId"),tid=text(n,"teamId");Set<String> seen=new HashSet<>(Set.of(id));
        while(!parent.equals("user")) {
            if(!seen.add(parent))throw new IllegalArgumentException("INVALID_RELATION: 上级关系成环");
            ObjectNode other=get(s,"employees",parent);
            if(!tid.equals(text(other,"teamId")))throw new IllegalArgumentException("INVALID_RELATION: 上级必须属于本团队");
            parent=text(other,"parentId");
        }
    }
    private static ObjectNode saveKnowledge(ObjectNode s,TeamActor a,ObjectNode p) {
        human(a);String id=text(p,"id");
        ObjectNode n=id.isEmpty()?node("id",id()):get(s,"knowledge",id).deepCopy();
        if(!id.isEmpty())revision(n,p);
        n.put("title",required(p,"title")).put("content",required(p,"content"));
        n.put("category",text(p,"category"));return save(s,"knowledge",n,a);
    }
    private static ObjectNode mount(ObjectNode s,TeamActor a,ObjectNode p,boolean add) {
        human(a);ObjectNode employee=get(s,"employees",required(p,"employeeId"));
        String source=required(p,"sourceId");get(s,"knowledge",source);
        ArrayNode mounts=list(employee,"knowledgeIds");ArrayNode next=JsonNodeFactory.instance.arrayNode();
        for(JsonNode n:mounts)if(!n.asText().equals(source))next.add(n);
        if(add)next.add(source);
        if(!mounts.equals(next)) {
            ObjectNode updated=employee.deepCopy();
            updated.set("knowledgeIds",next);
            save(s,"employees",updated,a);
        }
        return node("id",text(employee,"id")).put("mounted",add);
    }
    private static ObjectNode project(ObjectNode s,TeamActor a,ObjectNode p,String kind) {
        if(kind.equals("document.save")) {
            ObjectNode project=get(s,"projects",required(p,"projectId"));
            team(a,text(project,"teamId"));
            ObjectNode task=null;
            if(!a.human()) {
                task=get(s,"tasks",required(p,"taskId"));
                ObjectNode work=get(s,"workItems",text(task,"workItemId"));
                if(!a.id().equals(text(task,"employeeId"))||!text(project,"id").equals(text(work,"projectId")))
                    throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工只能归档自身工作所关联项目的文档");
                TaskFlow.requireWorkAllowed(s,task);
            }
            String id=text(p,"id");
            ObjectNode doc=id.isEmpty()?node("id",id()):get(project,"documents",id).deepCopy();
            if(!id.isEmpty())revision(doc,p);
            doc.put("title",required(p,"title")).put("content",required(p,"content"));
            doc.put("projectId",text(project,"id"));
            if(task!=null)doc.put("taskId",text(task,"id")).put("workItemId",text(task,"workItemId")).put("runId",text(task,"runId"));
            else doc.remove(List.of("taskId","workItemId","runId"));
            return save(project,"documents",doc,a);
        }
        human(a);
        String id=text(p,"id");ObjectNode n=id.isEmpty()?node("id",id(),"teamId",required(p,"teamId")):get(s,"projects",id).deepCopy();
        if(!id.isEmpty())revision(n,p);get(s,"teams",required(n,"teamId"));
        for(String f:List.of("name","description","repositoryUrl","targetBranch"))if(p.has(f))n.put(f,text(p,f));
        if(text(n,"name").isBlank())throw new IllegalArgumentException("INVALID_INPUT: 项目名称不能为空");
        if(text(n,"targetBranch").isBlank())n.put("targetBranch","main");
        if(p.has("protectedBranches"))n.set("protectedBranches",p.path("protectedBranches").deepCopy());
        if(p.has("checkCommand"))n.put("checkCommand",text(p,"checkCommand"));
        if(p.has("localDirectory")) {
            JsonNode before=n.get("localDirectory");
            if(p.hasNonNull("localDirectory"))n.set("localDirectory",p.get("localDirectory").deepCopy());
            else n.remove("localDirectory");
            if(!Objects.equals(before,n.get("localDirectory")))n.remove(List.of("baselineCommit","baselineBundle"));
        }
        return save(s,"projects",n,a);
    }
    private static ObjectNode finishLegacyDraft(ObjectNode state,TeamActor actor,ObjectNode payload) {
        if(!actor.type().equals("template"))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 非历史草稿生成实例");
        ObjectNode draft=get(state,"drafts",actor.id());
        draft.put("busy",false).put("name",required(payload,"name")).put("prompt",required(payload,"prompt"));
        draft.remove("error");
        draft.set("skills",payload.path("skills").deepCopy());
        list(draft,"messages").add(node("role","assistant","content",text(payload,"summary")));
        return node("id",actor.id());
    }
}
