package com.gill.web.controller;

import com.gill.web.config.GillProperties;
import com.gill.web.security.JwtUtil;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 认证：注册/登录/me（FR-11~16 简化实现：bcrypt + JWT + 登录失败锁定走 Redis 由限流阶段补全）。 */
@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {
    private final JdbcTemplate db;
    private final JwtUtil jwt;
    private final GillProperties props;

    public AuthController(JdbcTemplate db, JwtUtil jwt, GillProperties props) {
        this.db = db; this.jwt = jwt; this.props = props;
    }

    public record RegisterReq(String username, String password) {}
    public record LoginReq(String username, String password) {}

    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody RegisterReq req) {
        if (req.username() == null || !req.username().matches("[a-zA-Z0-9_-]{3,32}"))
            return err("AUTH-1002", "用户名格式无效（3-32 位字母数字_-）", 400);
        if (req.password() == null || req.password().length() < 8 || !req.password().matches(".*[a-zA-Z].*") || !req.password().matches(".*\\d.*"))
            return err("AUTH-1003", "密码至少 8 位且包含字母与数字", 400);
        Integer exists = db.queryForObject("SELECT COUNT(*) FROM users WHERE lower(username)=lower(?)", Integer.class, req.username());
        if (exists != null && exists > 0)
            return err("AUTH-1002", "用户名已存在", 409);
        String hash = BCrypt.hashpw(req.password(), BCrypt.gensalt(10));
        Long uid = db.queryForObject(
                "INSERT INTO users(username, password_hash) VALUES (?,?) RETURNING id", Long.class, req.username(), hash);
        // 个人空间（FR-131：注册即建）+ 成员关系
        String spaceId = UUID.randomUUID().toString();
        db.update("INSERT INTO spaces(id, type, name, owner_user_id) VALUES (?::uuid,'personal',?,?)",
                spaceId, req.username() + " 的空间", uid);
        db.update("INSERT INTO space_members(space_id, user_id, role) VALUES (?::uuid,?,'owner')", spaceId, uid);
        return ResponseEntity.ok(Map.of("id", uid, "username", req.username()));
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody LoginReq req) {
        List<Map<String, Object>> rows = db.queryForList(
                "SELECT id, password_hash, role, status FROM users WHERE lower(username)=lower(?)", req.username());
        if (rows.isEmpty() || !BCrypt.checkpw(req.password() == null ? "" : req.password(), (String) rows.get(0).get("password_hash")))
            return err("AUTH-1001", "用户名或密码错误", 401);
        Map<String, Object> u = rows.get(0);
        if (!"ACTIVE".equals(u.get("status")))
            return err("AUTH-1005", "账号已被禁用", 401);
        db.update("UPDATE users SET last_login_at=now() WHERE id=?", u.get("id"));
        return ResponseEntity.ok(Map.of("token", jwt.issue(((Number) u.get("id")).longValue(), (String) u.get("role")),
                "role", u.get("role")));
    }

    @GetMapping("/me")
    public ResponseEntity<?> me(@RequestAttribute("uid") Long uid) {
        return ResponseEntity.ok(db.queryForMap(
                "SELECT id, username, role, status, created_at FROM users WHERE id=?", uid));
    }

    static ResponseEntity<?> err(String code, String msg, int status) {
        return ResponseEntity.status(status).body(Map.of("error", Map.of("code", code, "message", msg)));
    }
}
