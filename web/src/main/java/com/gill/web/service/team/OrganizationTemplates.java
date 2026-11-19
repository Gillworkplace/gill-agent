package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.*;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import static com.gill.web.service.team.TeamData.*;

/** Versioned copies of team workflows and role definitions. */
final class OrganizationTemplates {
    private OrganizationTemplates() {}

    static ObjectNode saveTemplate(ObjectNode state, TeamActor actor, ObjectNode input) {
        human(actor);
        String type=required(input,"type");
        if(!Set.of("team","role").contains(type))
            throw new IllegalArgumentException("INVALID_INPUT: 请选择团队模板或角色模板");
        String identifier=text(input,"id"), source=text(input,"sourceId");
        ObjectNode record;
        if(identifier.isBlank()) {
            record=source.isBlank()?node():copySource(state,type,required(input,"sourceType"),source);
            record.put("id",id()).put("type",type);
        } else {
            record=get(state,"organizationTemplates",identifier).deepCopy();
            revision(record,input);
            if(!type.equals(text(record,"type"))||!source.isBlank())
                throw new IllegalArgumentException("INVALID_INPUT: 模板类型和来源在创建时确定");
        }
        record.put("name",required(input,"name"));
        for(String field:Set.of("description","prompt"))if(input.has(field))record.put(field,text(input,field));
        if(input.has("promptFiles")) {
            TemplateFiles.validateManifest(input.path("promptFiles"));
            record.set("promptFiles",input.get("promptFiles").deepCopy());
        }
        if(type.equals("team"))updateRoles(state,record,input);
        return save(state,"organizationTemplates",record,actor);
    }

    static ObjectNode requiredTemplate(ObjectNode state,String type,String identifier) {
        ObjectNode value=get(state,"organizationTemplates",identifier);
        if(!type.equals(text(value,"type")))
            throw new IllegalArgumentException("INVALID_INPUT: 模板类型与创建对象不匹配");
        return value;
    }

    static ObjectNode select(ObjectNode state,String type,ObjectNode input) {
        ObjectNode template=requiredTemplate(state,type,required(input,"orgTemplateId"));
        if(template.path("revision").asInt()!=input.path("templateRevision").asInt(-1))
            throw new IllegalArgumentException("VERSION_CONFLICT: 模板已更新，请重新选择");
        return template;
    }

    private static ObjectNode copySource(ObjectNode state,String type,String sourceType,String sourceId) {
        if(!type.equals(sourceType)&&!(type.equals("role")&&sourceType.equals("legacy")))
            throw new IllegalArgumentException("INVALID_INPUT: 模板来源与类型不匹配");
        if(sourceType.equals("legacy")) {
            ObjectNode old=get(state,"templates",sourceId);
            ObjectNode result=configuration(old);
            if(old.has("files"))result.set("promptFiles",old.get("files").deepCopy());
            return result;
        }
        if(type.equals("role"))return configuration(get(state,"teamRoles",sourceId));
        ObjectNode result=configuration(get(state,"teams",sourceId));
        ArrayNode roles=result.putArray("roles");
        for(JsonNode role:map(state,"teamRoles")) {
            if(sourceId.equals(text(role,"teamId")))roles.add(configuration(role));
        }
        return result;
    }

    private static void updateRoles(ObjectNode state,ObjectNode template,ObjectNode input) {
        ArrayNode next=JsonNodeFactory.instance.arrayNode();
        Set<String> removed=new HashSet<>(), names=new HashSet<>();
        for(JsonNode name:input.path("removedRoles"))removed.add(name.asText());
        for(JsonNode role:template.path("roles")) {
            if(!removed.contains(text(role,"name")))addRole(next,names,role);
        }
        for(JsonNode id:input.path("roleTemplateIds"))addRole(next,names,requiredTemplate(state,"role",id.asText()));
        template.set("roles",next);
    }

    private static void addRole(ArrayNode roles,Set<String> names,JsonNode role) {
        String name=required(role,"name");
        if(name.length()>30)throw new IllegalArgumentException("INVALID_INPUT: 角色名称最多30字");
        if(!names.add(name.toLowerCase(Locale.ROOT)))
            throw new IllegalArgumentException("INVALID_INPUT: 团队模板中有同名角色");
        roles.add(configuration(role));
    }

    static ObjectNode configuration(JsonNode source) {
        return ((ObjectNode)source).deepCopy().retain("name","description","prompt","promptFiles","skills");
    }

    static void copyRoleFields(ObjectNode target,JsonNode source) {
        for(String field:Set.of("prompt","promptFiles","skills")) {
            if(source.has(field)) target.set(field,source.get(field).deepCopy());
        }
    }

    static void createRoles(ObjectNode state,TeamActor actor,String teamId,ObjectNode template) {
        for(JsonNode source:template.path("roles")) {
            ObjectNode role=configuration(source).put("id",id()).put("teamId",teamId);
            save(state,"teamRoles",role,actor);
        }
    }
}
