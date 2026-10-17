package com.gill.web.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 空间与成员（FR-131/132）：个人空间自动存在；协作空间创建/成员查询。 */
@RestController
@RequestMapping("/api/v1")
public class SpaceController {
    private final JdbcTemplate db;

    public SpaceController(JdbcTemplate db) { this.db = db; }

    private Map<String, Object> requireMembership(String spaceId, long uid) {
        List<Map<String, Object>> rows = db.queryForList(
                "SELECT s.id::text AS id, s.type, s.name, sm.role FROM spaces s " +
                "JOIN space_members sm ON sm.space_id=s.id AND sm.user_id=? WHERE s.id=?::uuid AND s.dissolved_at IS NULL",
                uid, spaceId);
        if (rows.isEmpty()) throw new ApiException("SESS-2002", "无权访问该空间", 403);
        return rows.get(0);
    }

    @GetMapping("/spaces")
    public List<Map<String, Object>> mySpaces(@RequestAttribute("uid") Long uid) {
        return db.queryForList(
                "SELECT s.id::text, s.type, s.name, s.created_at FROM spaces s " +
                "JOIN space_members sm ON sm.space_id=s.id AND sm.user_id=? WHERE s.dissolved_at IS NULL ORDER BY s.created_at", uid);
    }

    @PostMapping("/spaces")
    public Map<String, Object> create(@RequestAttribute("uid") Long uid, @RequestBody Map<String, String> body) {
        String id = UUID.randomUUID().toString();
        String name = body.getOrDefault("name", "协作空间");
        db.update("INSERT INTO spaces(id, type, name, owner_user_id) VALUES (?::uuid,'group',?,?)", id, name, uid);
        db.update("INSERT INTO space_members(space_id, user_id, role) VALUES (?::uuid,?,'owner')", id, uid);
        return Map.of("id", id, "name", name);
    }

    @PostMapping("/spaces/{id}/invites")
    public Map<String, Object> invite(@RequestAttribute("uid") Long uid, @PathVariable String id, @RequestBody Map<String, String> body) {
        requireMembership(id, uid);
        String username = body.get("username");
        if (username != null) { // 用户名直邀（即时生效）
            db.update("INSERT INTO space_members(space_id, user_id, role) " +
                      "SELECT ?::uuid, id, 'member' FROM users WHERE lower(username)=lower(?) " +
                      "ON CONFLICT DO NOTHING", id, username);
            return Map.of("ok", true, "mode", "direct");
        }
        String token = UUID.randomUUID().toString().replace("-", "");
        db.update("INSERT INTO invites(id, space_id, token, created_by, expires_at) VALUES (?::uuid,?::uuid,?,?,now()+interval '24 hours')",
                UUID.randomUUID(), id, token, uid);
        return Map.of("ok", true, "token", token, "expiresIn", "24h");
    }

    @PostMapping("/invites/{token}/accept")
    public ResponseEntity<?> accept(@RequestAttribute("uid") Long uid, @PathVariable String token) {
        List<Map<String, Object>> inv = db.queryForList(
                "SELECT space_id::text FROM invites WHERE token=? AND revoked=false AND expires_at>now() AND accepted_by IS NULL", token);
        if (inv.isEmpty()) return AuthController.err("SESS-2001", "邀请无效或已过期", 404);
        db.update("INSERT INTO space_members(space_id, user_id, role) VALUES (?::uuid,?,'member') ON CONFLICT DO NOTHING",
                inv.get(0).get("space_id"), uid);
        db.update("UPDATE invites SET accepted_by=? WHERE token=?", uid, token);
        return ResponseEntity.ok(Map.of("spaceId", inv.get(0).get("space_id")));
    }

    @GetMapping("/spaces/{id}/members")
    public List<Map<String, Object>> members(@RequestAttribute("uid") Long uid, @PathVariable String id) {
        requireMembership(id, uid);
        return db.queryForList("SELECT u.id, u.username, sm.role, sm.joined_at FROM space_members sm " +
                "JOIN users u ON u.id=sm.user_id WHERE sm.space_id=?::uuid ORDER BY sm.joined_at", id);
    }

    /** 空间内会话列表/创建（FR-21）。 */
    @GetMapping("/spaces/{id}/sessions")
    public List<Map<String, Object>> sessions(@RequestAttribute("uid") Long uid, @PathVariable String id) {
        requireMembership(id, uid);
        return db.queryForList("SELECT id::text, title, status, project_tag, created_at, last_active_at " +
                "FROM sessions WHERE space_id=?::uuid AND status NOT IN ('closed','archived') ORDER BY last_active_at DESC", id);
    }

    @PostMapping("/spaces/{id}/sessions")
    public Map<String, Object> createSession(@RequestAttribute("uid") Long uid, @PathVariable String id,
                                             @RequestBody(required = false) Map<String, String> body) {
        requireMembership(id, uid);
        String sid = UUID.randomUUID().toString();
        String title = body != null ? body.getOrDefault("title", "新会话") : "新会话";
        String tag = body != null ? body.get("project_tag") : null;
        db.update("INSERT INTO sessions(id, space_id, user_id, title, project_tag, status) VALUES (?::uuid,?::uuid,?,? ,?,'created')",
                sid, id, uid, title, tag);
        return Map.of("id", sid, "title", title);
    }

    @DeleteMapping("/sessions/{sid}")
    public Map<String, Object> closeSession(@RequestAttribute("uid") Long uid, @PathVariable String sid) {
        int n = db.update("UPDATE sessions SET status='closing', closed_at=now() WHERE id=?::uuid AND status NOT IN ('closed')", sid);
        return Map.of("ok", n > 0);
    }

    @GetMapping("/sessions/{sid}/messages")
    public List<Map<String, Object>> messages(@RequestAttribute("uid") Long uid, @PathVariable String sid,
                                              @RequestParam(defaultValue = "50") int limit,
                                              @RequestParam(required = false) Long before) {
        requireSessionAccess(uid, sid);
        return db.queryForList("SELECT seq, role, content, tool_name, actor_user_id, created_at FROM messages " +
                "WHERE session_id=?::uuid AND (?::bigint IS NULL OR seq<?::bigint) ORDER BY seq DESC LIMIT ?",
                sid, before, before, limit);
    }

    /** 会话属主/成员校验（FR-14）：通过 space_members 判定。 */
    void requireSessionAccess(long uid, String sid) {
        List<Map<String, Object>> rows = db.queryForList(
            "SELECT 1 FROM sessions s JOIN space_members sm ON sm.space_id=s.space_id AND sm.user_id=? WHERE s.id=?::uuid",
            uid, sid);
        if (rows.isEmpty()) throw new ApiException("SESS-2002", "无权访问该会话", 403);
    }

    /** 业务异常。 */
    public static class ApiException extends RuntimeException {
        public final String code; public final int status;
        public ApiException(String code, String msg, int status) { super(msg); this.code = code; this.status = status; }
    }
}
