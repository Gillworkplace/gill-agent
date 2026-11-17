package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.time.Instant;
import java.util.*;

/** Pure aggregate helpers; no transport, persistence, or service dependencies. */
public final class TeamData {
    private TeamData() {}
    public static ObjectNode map(ObjectNode s,String key) {
        if(!s.path(key).isObject())s.set(key,JsonNodeFactory.instance.objectNode());
        return (ObjectNode)s.get(key);
    }
    public static ArrayNode list(ObjectNode s,String key) {
        if(!s.path(key).isArray())s.set(key,JsonNodeFactory.instance.arrayNode());
        return (ArrayNode)s.get(key);
    }
    public static String text(JsonNode n,String key) { return n.path(key).asText(""); }
    public static String required(JsonNode n,String key) {
        String v=text(n,key).trim();
        if(v.isEmpty())throw new IllegalArgumentException("INVALID_INPUT: 缺少"+key);
        if(v.length()>100000)throw new IllegalArgumentException("INVALID_INPUT: 内容过长");
        return v;
    }
    public static ObjectNode get(ObjectNode s,String group,String id) {
        JsonNode n=map(s,group).get(id);
        if(n==null||!n.isObject())throw new IllegalArgumentException("NOT_FOUND: "+group+"/"+id);
        return (ObjectNode)n;
    }
    public static String id() { return UUID.randomUUID().toString(); }
    public static String now() { return Instant.now().toString(); }
    public static ObjectNode node(String... fields) {
        ObjectNode n=JsonNodeFactory.instance.objectNode();
        for(int i=0;i<fields.length;i+=2)n.put(fields[i],fields[i+1]);
        return n;
    }
    public static void human(TeamActor a) {
        if(!a.human())throw new IllegalArgumentException("SCOPE_FORBIDDEN: 仅用户可以调整此配置");
    }
    public static void team(TeamActor a,String team) {
        if(!a.human()&&!Objects.equals(a.teamId(),team))
            throw new IllegalArgumentException("SCOPE_FORBIDDEN: 不允许跨团队访问");
    }
    public static void revision(ObjectNode current,JsonNode p) {
        if(!p.has("expectedRevision")||p.path("expectedRevision").asLong(-1)!=current.path("revision").asLong())
            throw new IllegalArgumentException("VERSION_CONFLICT: 数据已变化，请重新读取后保存");
    }
    public static ObjectNode save(ObjectNode s,String group,ObjectNode n,TeamActor actor) {
        int rev=n.path("revision").asInt()+1;n.put("revision",rev).put("updatedAt",now());
        ObjectNode history=n.deepCopy();history.remove("versions");history.put("authorType",actor.type()).put("authorId",actor.id());
        list(n,"versions").add(history);map(s,group).set(required(n,"id"),n);
        return node("id",text(n,"id")).put("revision",rev);
    }
    public static void enqueue(ObjectNode s,ObjectNode job) {
        if(text(job,"kind").equals("turn"))job.put("generation",get(s,"tasks",required(job,"taskId")).path("generation").asInt(1));
        list(s,"pending").add(job.put("id",id()).put("createdAt",now()));
    }
    public static ObjectNode message(ObjectNode s,String team,String senderType,String sender,String text,String kind) {
        ObjectNode n=node("id",id(),"teamId",team,"senderType",senderType,"senderId",sender,"text",text,"kind",kind,"createdAt",now());
        map(s,"messages").set(text(n,"id"),n);return n;
    }
    public static String teamOf(ObjectNode s,String employee) {return required(get(s,"employees",employee),"teamId");}
    public static void alert(ObjectNode s,String team,String text,String subject) {
        ObjectNode m=message(s,team,"system","system",text,"attention");m.put("mentionUser",true).put("status","needs-user").put("subjectId",subject);
    }
    public static void init(ObjectNode s) {
        for(String g:List.of("teams","templates","employees","knowledge","projects","workItems","tasks","runs","messages","deliveries","artifacts","decisions","drafts","checks","integrations","codeVersions"))map(s,g);
        list(s,"pending");
    }
}
