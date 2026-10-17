package com.gill.web.controller;

import io.minio.GetPresignedObjectUrlArgs;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.StatObjectArgs;
import io.minio.errors.ErrorResponseException;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;

import java.io.InputStream;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

/** 文件网关（FR-61~66）：预签名直传 / 完成 / 列表 / 下载链接。 */
@RestController
@RequestMapping("/api/v1")
public class FileController {
    private final JdbcTemplate db;
    private final MinioClient minio;
    private static final String BUCKET = "gill-files";

    public FileController(JdbcTemplate db) {
        this.db = db;
        String ep = env("MINIO_ENDPOINT", "http://minio:9000");
        this.minio = MinioClient.builder().endpoint(ep)
                .credentials(env("MINIO_ROOT_USER", "gilladmin"), env("MINIO_ROOT_PASSWORD", "gillminio123"))
                .build();
    }

    private static String env(String k, String d) { return System.getenv(k) == null ? d : System.getenv(k); }

    private String spaceOf(long uid, String sid) {
        return db.queryForObject(
                "SELECT s.space_id::text FROM sessions s JOIN space_members sm ON sm.space_id=s.space_id AND sm.user_id=? WHERE s.id=?::uuid",
                String.class, uid, sid);
    }

    public record UploadReq(String filename, long size, String sessionId) {}

    @PostMapping("/files/uploads")
    public ResponseEntity<?> requestUpload(@RequestAttribute("uid") Long uid, @RequestBody UploadReq req) throws Exception {
        String name = sanitize(req.filename());
        if (name == null || req.size() > 500 * 1024 * 1024)
            return AuthController.err("FILE-4004", "文件名非法或超过 500MB", 400);
        String spaceId = spaceOf(uid, req.sessionId());
        String objectKey = "uploads/" + spaceId + "/" + UUID.randomUUID() + "/" + name;
        String url = minio.getPresignedObjectUrl(
                GetPresignedObjectUrlArgs.builder().method(io.minio.http.Method.PUT).bucket(BUCKET)
                        .object(objectKey).expiry(15, java.util.concurrent.TimeUnit.MINUTES).build());
        String id = UUID.randomUUID().toString();
        db.update("INSERT INTO file_objects(id, space_id, user_id, session_id, direction, object_key, filename, size_bytes, status) " +
                        "VALUES (?::uuid,?::uuid,?,?::uuid,'upload',?,?,?,'pending')",
                id, spaceId, uid, req.sessionId(), objectKey, name, req.size());
        return ResponseEntity.ok(Map.of("uploadId", id, "url", url, "objectKey", objectKey));
    }

    @PostMapping("/files/uploads/{id}/complete")
    public ResponseEntity<?> complete(@RequestAttribute("uid") Long uid, @PathVariable String id) throws Exception {
        var rows = db.queryForList("SELECT object_key, size_bytes FROM file_objects WHERE id=?::uuid AND user_id=?", id, uid);
        if (rows.isEmpty()) return AuthController.err("FILE-4005", "上传记录不存在", 404);
        try {
            minio.statObject(StatObjectArgs.builder().bucket(BUCKET).object((String) rows.get(0).get("object_key")).build());
        } catch (ErrorResponseException e) {
            return AuthController.err("FILE-4005", "对象尚未上传", 400);
        }
        db.update("UPDATE file_objects SET status='uploaded' WHERE id=?::uuid", id);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/spaces/{sid}/files")
    public Object list(@RequestAttribute("uid") Long uid, @PathVariable String sid) {
        return db.queryForList(
                "SELECT id::text, filename, size_bytes, status, direction, created_at FROM file_objects " +
                "WHERE space_id=?::uuid AND user_id=? ORDER BY created_at DESC LIMIT 200", sid, uid);
    }

    @PostMapping("/files/{id}/download-url")
    public ResponseEntity<?> downloadUrl(@RequestAttribute("uid") Long uid, @PathVariable String id) throws Exception {
        var rows = db.queryForList("SELECT object_key, filename FROM file_objects WHERE id=?::uuid AND user_id=?", id, uid);
        if (rows.isEmpty()) return AuthController.err("FILE-4005", "文件不存在", 404);
        String url = minio.getPresignedObjectUrl(
                GetPresignedObjectUrlArgs.builder().method(io.minio.http.Method.GET).bucket(BUCKET)
                        .object((String) rows.get(0).get("object_key")).expiry(30, java.util.concurrent.TimeUnit.MINUTES).build());
        return ResponseEntity.ok(Map.of("url", url, "filename", rows.get(0).get("filename")));
    }

    static String sanitize(String name) {
        if (name == null) return null;
        name = name.replace("\\", "/");
        if (name.contains("..") || name.startsWith("/") || name.length() > 255) return null;
        return name.replaceAll("[\\x00-\\x1f]", "_");
    }
}
