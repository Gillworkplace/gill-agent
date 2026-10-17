package com.gill.web.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 知识库管理 API（FR-97）：列表/搜索/增删改/置顶。 */
@RestController
@RequestMapping("/api/v1")
public class KnowledgeController {
    private final JdbcTemplate db;

    public KnowledgeController(JdbcTemplate db) { this.db = db; }

    @GetMapping("/spaces/{sid}/knowledge")
    public List<Map<String, Object>> list(@RequestAttribute("uid") Long uid, @PathVariable String sid,
                                          @RequestParam(required = false) String q,
                                          @RequestParam(required = false) String type) {
        String typeCond = (type == null) ? "" : " AND type='" + type.replaceAll("[^a-z]", "") + "'";
        if (q != null && !q.isBlank()) {
            return db.queryForList(
                    "SELECT id::text, scope, type, title, content, array_to_string(tags, ',') AS tags, source, hit_count, pinned, version, created_at, updated_at " +
                    "FROM knowledge_items WHERE (user_id=? OR space_id=?::uuid) AND status='active' " +
                    "AND (content ILIKE '%'||?||'%' OR title ILIKE '%'||?||'%')" + typeCond +
                    " ORDER BY pinned DESC, updated_at DESC LIMIT 200", uid, sid, q, q);
        }
        return db.queryForList(
                "SELECT id::text, scope, type, title, content, array_to_string(tags, ',') AS tags, source, hit_count, pinned, version, created_at, updated_at " +
                "FROM knowledge_items WHERE (user_id=? OR space_id=?::uuid) AND status='active'" + typeCond +
                " ORDER BY pinned DESC, updated_at DESC LIMIT 200", uid, sid);
    }

    @PostMapping("/spaces/{sid}/knowledge")
    public Map<String, Object> create(@RequestAttribute("uid") Long uid, @PathVariable String sid,
                                      @RequestBody Map<String, Object> b) {
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO knowledge_items(id, user_id, space_id, scope, type, title, content, source, confidence) " +
                        "VALUES (?::uuid,?,?::uuid,?,?,?,?, 'explicit', 1.0)",
                id, uid, sid, b.getOrDefault("scope", "user"), b.getOrDefault("type", "fact"),
                b.get("title"), b.get("content"));
        return Map.of("id", id);
    }

    @PatchMapping("/knowledge/{id}")
    public Map<String, Object> update(@RequestAttribute("uid") Long uid, @PathVariable String id,
                                      @RequestBody Map<String, Object> b) {
        int n = 0;
        if (b.containsKey("content"))
            n += db.update("UPDATE knowledge_items SET content=?, updated_at=now(), version=version+1 WHERE id=?::uuid AND (user_id=? OR EXISTS(SELECT 1 FROM space_members sm JOIN knowledge_items k ON k.space_id=sm.space_id WHERE k.id=?::uuid AND sm.user_id=?))",
                    b.get("content"), id, uid, id, uid);
        if (b.containsKey("title"))
            n += db.update("UPDATE knowledge_items SET title=?, updated_at=now() WHERE id=?::uuid AND user_id=?", b.get("title"), id, uid);
        if (b.containsKey("pinned"))
            n += db.update("UPDATE knowledge_items SET pinned=? WHERE id=?::uuid AND user_id=?", b.get("pinned"), id, uid);
        return Map.of("ok", n > 0);
    }

    @DeleteMapping("/knowledge/{id}")
    public Map<String, Object> delete(@RequestAttribute("uid") Long uid, @PathVariable String id) {
        int n = db.update("DELETE FROM knowledge_items WHERE id=?::uuid AND (user_id=? OR EXISTS(" +
                "SELECT 1 FROM space_members sm JOIN knowledge_items k ON k.space_id=sm.space_id " +
                "WHERE k.id=?::uuid AND sm.user_id=? AND sm.role IN ('admin','owner')))", id, uid, id, uid);
        return Map.of("ok", n > 0);
    }
}
