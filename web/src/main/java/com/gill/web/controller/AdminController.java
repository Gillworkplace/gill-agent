package com.gill.web.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** 管理后台（FR-7x 简化版）：用户列表/启停、审计查询。仅 ADMIN。 */
@RestController
@RequestMapping("/api/v1/admin")
public class AdminController {
    private final JdbcTemplate db;

    public AdminController(JdbcTemplate db) { this.db = db; }

    private boolean isAdmin(Long uid) {
        return "ADMIN".equals(db.queryForObject("SELECT role FROM users WHERE id=?", String.class, uid));
    }

    @GetMapping("/users")
    public ResponseEntity<?> users(@RequestAttribute("uid") Long uid) {
        if (!isAdmin(uid)) return AuthController.err("AUTH-403", "仅管理员", 403);
        return ResponseEntity.ok(db.queryForList(
                "SELECT id, username, role, status, created_at, last_login_at FROM users ORDER BY id LIMIT 200"));
    }

    @PatchMapping("/users/{id}")
    public ResponseEntity<?> toggle(@RequestAttribute("uid") Long uid, @PathVariable Long id,
                                    @RequestBody Map<String, Object> body) {
        if (!isAdmin(uid)) return AuthController.err("AUTH-403", "仅管理员", 403);
        int n = db.update("UPDATE users SET status=? WHERE id=?", body.getOrDefault("status", "ACTIVE"), id);
        return ResponseEntity.ok(Map.of("ok", n > 0));
    }

    @GetMapping("/audit")
    public ResponseEntity<?> audit(@RequestAttribute("uid") Long uid,
                                   @RequestParam(defaultValue = "50") int limit) {
        if (!isAdmin(uid)) return AuthController.err("AUTH-403", "仅管理员", 403);
        return ResponseEntity.ok(db.queryForList(
                "SELECT ca.command, ca.exit_code, ca.duration_ms, ca.sandbox_id, ca.created_at, u.username " +
                "FROM command_audit ca JOIN users u ON u.id=ca.user_id ORDER BY ca.id DESC LIMIT ?", limit));
    }
}
