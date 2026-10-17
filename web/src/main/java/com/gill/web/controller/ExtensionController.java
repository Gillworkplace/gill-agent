package com.gill.web.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 扩展中心 API（FR-106~108 最小版）：http-tools 扩展 CRUD + 工具清单。 */
@RestController
@RequestMapping("/api/v1")
public class ExtensionController {
    private final JdbcTemplate db;
    private final ObjectMapper om = new ObjectMapper();

    public ExtensionController(JdbcTemplate db) { this.db = db; }

    @GetMapping("/spaces/{sid}/extensions")
    public List<Map<String, Object>> list(@RequestAttribute("uid") Long uid, @PathVariable String sid) {
        return db.queryForList(
                "SELECT id::text, name, version, type, visibility, status, call_count_7d, created_at " +
                "FROM extensions WHERE (user_id=? AND space_id=?::uuid) OR (visibility='space' AND space_id=?::uuid) " +
                "ORDER BY created_at DESC", uid, sid, sid);
    }

    /** body: {name, manifest:{tools:[{name,desc,method,url,params,auth,network}]}} */
    @PostMapping("/spaces/{sid}/extensions")
    public ResponseEntity<?> create(@RequestAttribute("uid") Long uid, @PathVariable String sid,
                                    @RequestBody Map<String, Object> body) {
        String name = String.valueOf(body.get("name"));
        if (!name.matches("[a-z0-9-]{2,32}"))
            return AuthController.err("EXT-8101", "扩展名需为 2-32 位小写字母数字连字符", 400);
        Object manifest = body.get("manifest");
        String extType = String.valueOf(body.getOrDefault("extType", "http-tools"));
        boolean valid;
        if (manifest instanceof Map m && m.get("tools") instanceof List<?> tl && !tl.isEmpty()) {
            valid = tl.stream().allMatch(t -> t instanceof Map tm &&
                    ("script-tools".equals(extType) ? tm.get("code") != null : tm.get("url") != null));
        } else if ("skill".equals(extType) && manifest instanceof Map ms && ms.get("skill") != null) {
            valid = true;
        } else valid = false;
        if (!valid)
            return AuthController.err("EXT-8101", "manifest 非法（http 需 url / script 需 code / skill 需 skill）", 400);
        String manifestJson;
        try { manifestJson = om.writeValueAsString(manifest); }
        catch (Exception e) { return AuthController.err("EXT-8101", "manifest 序列化失败", 400); }
        Integer n = db.queryForObject(
                "SELECT COUNT(*) FROM extensions WHERE space_id=?::uuid AND lower(name)=lower(?)", Integer.class, sid, name);
        if (n != null && n > 0)
            return AuthController.err("EXT-8103", "同名扩展已存在", 409);
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO extensions(id, user_id, space_id, visibility, name, version, type, manifest, status) " +
                        "VALUES (?::uuid,?,?::uuid,'private',?,'1.0',?,?::jsonb,'enabled')",
                id, uid, sid, name, extType, manifestJson);
        return ResponseEntity.ok(Map.of("id", id, "name", name));
    }

    @GetMapping("/extensions/{id}/tools")
    @SuppressWarnings("unchecked")
    public List<Map<String, Object>> tools(@RequestAttribute("uid") Long uid, @PathVariable String id) {
        var rows = db.queryForList("SELECT name, manifest::text AS manifest FROM extensions WHERE id=?::uuid AND user_id=?", id, uid);
        if (rows.isEmpty()) return List.of();
        var raw = rows.get(0).get("manifest");
        Map<String, Object> parsed;
        if (raw instanceof String s) {
            try { parsed = om.readValue(s, Map.class); } catch (Exception e) { return List.of(); }
        } else if (raw instanceof Map<?, ?> m) {
            parsed = (Map<String, Object>) m;
        } else return List.of();
        Object toolsObj = parsed.get("tools");
        if (!(toolsObj instanceof List<?> l)) return List.of();
        return l.stream().filter(t -> t instanceof Map).map(t -> {
            var tm = (Map<String, Object>) t;
            return Map.<String, Object>of("tool", "ext_" + rows.get(0).get("name") + "_" + tm.get("name"),
                    "desc", String.valueOf(tm.getOrDefault("desc", "")),
                    "url", String.valueOf(tm.get("url")));
        }).toList();
    }

    @PatchMapping("/extensions/{id}")
    public Map<String, Object> toggle(@RequestAttribute("uid") Long uid, @PathVariable String id,
                                      @RequestBody Map<String, Object> body) {
        int n = db.update("UPDATE extensions SET status=? WHERE id=?::uuid AND user_id=?",
                body.getOrDefault("status", "enabled"), id, uid);
        return Map.of("ok", n > 0);
    }

    @DeleteMapping("/extensions/{id}")
    public Map<String, Object> delete(@RequestAttribute("uid") Long uid, @PathVariable String id) {
        int n = db.update("DELETE FROM extensions WHERE id=?::uuid AND user_id=?", id, uid);
        return Map.of("ok", n > 0);
    }
}
