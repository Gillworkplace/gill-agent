package com.gill.web.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.security.SecureRandom;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 个人访问令牌（FR-16）：创建仅展示一次 / 列表 / 吊销。CLI 等外部工具用它走 REST。 */
@RestController
@RequestMapping("/api/v1/me/pats")
public class PatController {
    private final JdbcTemplate db;
    private static final SecureRandom RNG = new SecureRandom();

    public PatController(JdbcTemplate db) { this.db = db; }

    @PostMapping
    public ResponseEntity<?> create(@RequestAttribute("uid") Long uid, @RequestBody(required = false) Map<String, String> body) {
        byte[] raw = new byte[24];
        RNG.nextBytes(raw);
        String token = "gpat_" + HexFormat.of().formatHex(raw);   // 明文仅此一次
        String hash = sha256(token);
        String name = body != null ? body.getOrDefault("name", "cli") : "cli";
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO pats(id, user_id, name, token_hash) VALUES (?::uuid,?,?,?)", id, uid, name, hash);
        return ResponseEntity.ok(Map.of("id", id, "name", name, "token", token,
                "hint", "请立即保存，关闭后不再显示"));
    }

    @GetMapping
    public List<Map<String, Object>> list(@RequestAttribute("uid") Long uid) {
        return db.queryForList("SELECT id::text, name, created_at, last_used_at, revoked FROM pats WHERE user_id=? ORDER BY created_at DESC", uid);
    }

    @DeleteMapping("/{id}")
    public Map<String, Object> revoke(@RequestAttribute("uid") Long uid, @PathVariable String id) {
        int n = db.update("UPDATE pats SET revoked=true WHERE id=?::uuid AND user_id=?", id, uid);
        return Map.of("ok", n > 0);
    }

    public static String sha256(String s) {
        try {
            return HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256").digest(s.getBytes()));
        } catch (Exception e) { throw new RuntimeException(e); }
    }
}
