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
            case "template.share" -> shareTemplate(s,a,p);
            case "template.save","template.revise" -> saveTemplate(s,a,p);
            case "employee.create","employee.update" -> saveEmployee(s,a,p);
            case "knowledge.save" -> saveKnowledge(s,a,p);
            case "knowledge.mount","knowledge.unmount" -> mount(s,a,p,kind.endsWith(".mount"));
            case "project.save","document.save","workspace.configure" -> project(s,a,p,kind);
            case "template.generate","draft.generated" -> draft(s,a,p,kind);
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
        n.put("name",required(p,"name"));
        for(String f:List.of("description","prompt","receiverId"))if(p.has(f))n.put(f,text(p,f));
        if(p.has("limits")){
            int calls=p.path("limits").path("maxRounds").asInt(25),seconds=p.path("limits").path("maxSeconds").asInt(900);
            if(calls<1||calls>1000||seconds<1||seconds>86400)throw new IllegalArgumentException("INVALID_INPUT: 调用上限需为1至1000，运行时长为1至86400秒");
            n.set("limits",p.get("limits").deepCopy());
        }
        return save(s,"teams",n,a);
    }
    private static ObjectNode saveTemplate(ObjectNode s,TeamActor a,ObjectNode p) {
        String id=text(p,"id");ObjectNode n=id.isEmpty()?node("id",id()):get(s,"templates",id).deepCopy();
        if(!a.human()) {
            if(id.isEmpty())throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工只能迭代已有模板");
            ObjectNode employee=get(s,"employees",a.id());
            if(!id.equals(text(employee,"templateId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 非本员工采用的模板");
            if(p.path("knowledgeRefs").size()>0)
                throw new IllegalArgumentException("REVIEW_REQUIRED: 模板不能自动传播挂载知识，请提交去除知识正文的候选");
        }
        if(!a.human())guardKnowledgeCopy(s,a,p);
        if(!id.isEmpty())revision(n,p);
        n.put("name",required(p,"name")).put("prompt",required(p,"prompt"));
        n.set("skills",p.path("skills").isArray()?p.get("skills").deepCopy():JsonNodeFactory.instance.arrayNode());
        if(!a.human()){n.put("originTeamId",a.teamId());n.putArray("authorizedTeamIds").add(a.teamId());}
        n.put("reason",text(p,"reason")).put("draftId",text(p,"draftId"));
        return save(s,"templates",n,a);
    }
    private static void guardKnowledgeCopy(ObjectNode s,TeamActor a,ObjectNode p) {
        StringBuilder candidate=new StringBuilder(text(p,"prompt"));
        for(JsonNode skill:p.path("skills"))candidate.append('\n').append(text(skill,"content"));
        List<JsonNode> sources=new ArrayList<>();
        for(JsonNode source:list(get(s,"employees",a.id()),"knowledgeIds"))sources.add(get(s,"knowledge",source.asText()));
        if(p.has("taskId")) {
            ObjectNode task=get(s,"tasks",required(p,"taskId"));
            if(!a.id().equals(text(task,"employeeId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 非本员工任务");
            for(JsonNode source:map(task,"retainedKnowledge"))sources.add(source);
        }
        for(JsonNode source:sources){String content=text(source,"content");
            if(content.length()>=12&&candidate.indexOf(content)>=0)throw new IllegalArgumentException("KNOWLEDGE_COPY_FORBIDDEN: 模板不能复制知识正文");
        }
    }
    private static ObjectNode shareTemplate(ObjectNode s,TeamActor a,ObjectNode p) {
        human(a);ObjectNode template=get(s,"templates",required(p,"id"));revision(template,p);
        ArrayNode targets=JsonNodeFactory.instance.arrayNode();
        String origin=text(template,"originTeamId");if(!origin.isBlank())targets.add(origin);
        for(JsonNode target:p.path("teamIds")){String tid=target.asText();get(s,"teams",tid);if(!tid.equals(origin))targets.add(tid);}
        template.set("authorizedTeamIds",targets);
        list(template,"sharingRecords").add(node("at",now(),"actorId",a.id()).put("templateRevision",template.path("revision").asInt()).set("teamIds",targets.deepCopy()));
        return node("id",text(template,"id")).put("revision",template.path("revision").asInt());
    }
    private static ObjectNode saveEmployee(ObjectNode s,TeamActor a,ObjectNode p) {
        human(a);String id=text(p,"id");boolean fresh=id.isEmpty();
        ObjectNode n=fresh?node("id",id(),"teamId",required(p,"teamId")):get(s,"employees",id).deepCopy();
        String tid=required(n,"teamId");get(s,"teams",tid);
        if(!fresh)revision(n,p);
        if(p.has("teamId")&&!tid.equals(text(p,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工不能跨团队移动");
        if(fresh) {
            ObjectNode tpl=get(s,"templates",required(p,"templateId"));
            String origin=text(tpl,"originTeamId");boolean shared=origin.isBlank()||origin.equals(tid);
            for(JsonNode target:tpl.path("authorizedTeamIds"))if(target.asText().equals(tid))shared=true;
            if(!shared&&!p.path("allowCrossTeamAdoption").asBoolean())throw new IllegalArgumentException("SCOPE_FORBIDDEN: 该模板迭代来自其他团队，需要用户明确授权本次采用");
            n.put("templateId",text(tpl,"id")).put("templateRevision",tpl.path("revision").asInt());
            n.put("prompt",text(tpl,"prompt")).put("basePrompt",text(tpl,"prompt"));
            n.set("skills",tpl.path("skills").deepCopy());n.set("baseSkills",tpl.path("skills").deepCopy());
            n.putArray("knowledgeIds");n.put("parentId","user").put("status","idle");
        }
        for(String f:List.of("name","role","prompt","parentId","lifecycle"))if(p.has(f))n.put(f,text(p,f));
        if(p.has("skills"))n.set("skills",p.path("skills").deepCopy());
        if(text(n,"name").isBlank())throw new IllegalArgumentException("INVALID_INPUT: 员工姓名不能为空");
        validateParent(s,n);
        ObjectNode result=save(s,"employees",n,a);
        ObjectNode t=get(s,"teams",tid);
        if(text(t,"receiverId").isBlank())t.put("receiverId",text(n,"id"));
        return result;
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
        if(add)next.add(source);employee.set("knowledgeIds",next);
        return node("id",text(employee,"id")).put("mounted",add);
    }
    private static ObjectNode project(ObjectNode s,TeamActor a,ObjectNode p,String kind) {
        human(a);
        if(kind.equals("document.save")) {
            ObjectNode project=get(s,"projects",required(p,"projectId"));
            ObjectNode docs=map(project,"documents");String id=text(p,"id");
            ObjectNode doc=id.isEmpty()?node("id",id()):((ObjectNode)docs.path(id)).deepCopy();
            if(!id.isEmpty())revision(doc,p);
            doc.put("title",required(p,"title")).put("content",required(p,"content"));
            return save(project,"documents",doc,a);
        }
        String id=text(p,"id");ObjectNode n=id.isEmpty()?node("id",id(),"teamId",required(p,"teamId")):get(s,"projects",id).deepCopy();
        if(!id.isEmpty())revision(n,p);get(s,"teams",required(n,"teamId"));
        for(String f:List.of("name","description","repositoryUrl","targetBranch"))if(p.has(f))n.put(f,text(p,f));
        if(text(n,"name").isBlank())throw new IllegalArgumentException("INVALID_INPUT: 项目名称不能为空");
        if(text(n,"targetBranch").isBlank())n.put("targetBranch","main");
        if(p.has("protectedBranches"))n.set("protectedBranches",p.path("protectedBranches").deepCopy());
        if(p.has("checkCommand"))n.put("checkCommand",text(p,"checkCommand"));
        return save(s,"projects",n,a);
    }
    private static ObjectNode draft(ObjectNode s,TeamActor a,ObjectNode p,String kind) {
        String id=text(p,"id");
        if(kind.equals("draft.generated")) {
            if(!a.type().equals("template"))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 非模板生成实例");
            ObjectNode d=get(s,"drafts",a.id());d.put("busy",false).put("name",required(p,"name")).put("prompt",required(p,"prompt"));
            d.set("skills",p.path("skills").deepCopy());list(d,"messages").add(node("role","assistant","content",text(p,"summary")));
            return node("id",a.id());
        }
        human(a);ObjectNode d=id.isBlank()?node("id",id()):get(s,"drafts",id);
        if(p.path("draft").isObject())for(String f:List.of("name","prompt","skills"))if(p.path("draft").has(f))d.set(f,p.path("draft").get(f).deepCopy());
        if(d.path("busy").asBoolean())throw new IllegalArgumentException("BUSY: 正在生成，请等待");
        list(d,"messages").add(node("role","user","content",required(p,"text")));d.put("busy",true);
        map(s,"drafts").set(text(d,"id"),d);enqueue(s,node("kind","template","draftId",text(d,"id")));
        return node("id",text(d,"id"));
    }
}
