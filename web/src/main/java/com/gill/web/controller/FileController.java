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

    // ---- BD-2 文件类型管控：黑名单扩展名 + 魔数检测（PE/ELF/OLE2/脚本 shebang）----
    private static final java.util.Set<String> EXT_BLACKLIST = java.util.Set.of(
            "exe", "dll", "scr", "msi", "com", "sys", "so", "bat", "cmd", "ps1", "vbs",
            "sh", "iso", "img", "vhd", "jar", "docm", "xlsm", "pptm");

    private static String checkMagic(byte[] head) {
        if (head.length >= 2 && (head[0] & 0xFF) == 0x4D && (head[1] & 0xFF) == 0x5A) return "PE 可执行（MZ）";
        if (head.length >= 4 && (head[0] & 0xFF) == 0x7F && head[1] == 'E' && head[2] == 'L' && head[3] == 'F') return "ELF 可执行";
        if (head.length >= 4 && (head[0] & 0xFF) == 0xD0 && (head[1] & 0xFF) == 0xCF && (head[2] & 0xFF) == 0x11 && (head[3] & 0xFF) == 0xE0) return "OLE2 宏文档";
        if (head.length >= 2 && head[0] == '#' && head[1] == '!') return "脚本 shebang";
        return null;
    }

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
        int dot = name.lastIndexOf('.');
        String ext = dot >= 0 ? name.substring(dot + 1).toLowerCase() : "";
        if (EXT_BLACKLIST.contains(ext))
            return AuthController.err("FILE-4002", "文件类型不允许：" + ext + "（黑名单管控）", 403);
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
        String key = (String) rows.get(0).get("object_key");
        try {
            var stat = minio.statObject(StatObjectArgs.builder().bucket(BUCKET).object(key).build());
            // 魔数复核（前 512B）：伪装扩展名也拦截
            try (var in = minio.getObject(io.minio.GetObjectArgs.builder().bucket(BUCKET).object(key)
                    .offset(0L).length(512L).build())) {
                byte[] head = in.readAllBytes();
                String hit = checkMagic(head);
                if (hit != null) {
                    minio.removeObject(io.minio.RemoveObjectArgs.builder().bucket(BUCKET).object(key).build());
                    db.update("UPDATE file_objects SET status='rejected' WHERE id=?::uuid", id);
                    return AuthController.err("FILE-4002", "文件内容检测到 " + hit + " 特征，已拒绝", 403);
                }
            }
        } catch (ErrorResponseException e) {
            return AuthController.err("FILE-4005", "对象尚未上传", 400);
        }
        db.update("UPDATE file_objects SET status='uploaded' WHERE id=?::uuid", id);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    /** FR-69 文件在线预览：文本类返回内容（≤1MB），图片类返回直链。 */
    @GetMapping("/files/{id}/preview")
    public ResponseEntity<?> preview(@RequestAttribute("uid") Long uid, @PathVariable String id) throws Exception {
        var rows = db.queryForList("SELECT object_key, filename FROM file_objects WHERE id=?::uuid AND user_id=? AND status IN ('uploaded','synced')", id, uid);
        if (rows.isEmpty()) return AuthController.err("FILE-4005", "文件不存在", 404);
        String name = (String) rows.get(0).get("filename");
        String key = (String) rows.get(0).get("object_key");
        String ext = name.contains(".") ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : "";
        if (java.util.Set.of("png", "jpg", "jpeg", "gif", "webp").contains(ext)) {
            String url = minio.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                    .method(io.minio.http.Method.GET).bucket(BUCKET).object(key)
                    .expiry(10, java.util.concurrent.TimeUnit.MINUTES).build());
            return ResponseEntity.ok(Map.of("type", "image", "url", url));
        }
        if (java.util.Set.of("txt", "md", "csv", "json", "py", "js", "ts", "html", "css", "xml", "yaml", "yml", "sql", "log", "sh").contains(ext)
                || ext.isEmpty()) {
            try (var in = minio.getObject(io.minio.GetObjectArgs.builder().bucket(BUCKET).object(key).build())) {
                byte[] all = in.readNBytes(1024 * 1024);
                return ResponseEntity.ok(Map.of("type", "text", "content", new String(all, java.nio.charset.StandardCharsets.UTF_8)));
            }
        }
        return ResponseEntity.ok(Map.of("type", "binary", "filename", name));
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
