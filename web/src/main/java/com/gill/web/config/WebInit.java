package com.gill.web.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCrypt;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

import jakarta.annotation.PostConstruct;
import java.nio.file.Files;

/** 启动初始化：管理员账号 + 前端静态托管（SPA fallback 到 index.html）。 */
@Configuration
@EnableScheduling
@EnableConfigurationProperties(GillProperties.class)
public class WebInit implements WebMvcConfigurer {
    private final JdbcTemplate db;
    private final GillProperties props;

    public WebInit(JdbcTemplate db, GillProperties props) { this.db = db; this.props = props; }

    @PostConstruct
    public void initAdmin() {
        String u = props.initAdminUsername();
        if (u == null || u.isBlank()) return;
        Integer n = db.queryForObject("SELECT COUNT(*) FROM users WHERE lower(username)=lower(?)", Integer.class, u);
        if (n != null && n == 0) {
            String pwd = (props.initAdminPassword() == null || props.initAdminPassword().isBlank())
                    ? java.util.UUID.randomUUID().toString().substring(0, 12)
                    : props.initAdminPassword();
            Long uid = db.queryForObject(
                    "INSERT INTO users(username, password_hash, role) VALUES (?,?,'ADMIN') RETURNING id",
                    Long.class, u, BCrypt.hashpw(pwd, BCrypt.gensalt(10)));
            String spaceId = java.util.UUID.randomUUID().toString();
            db.update("INSERT INTO spaces(id, type, name, owner_user_id) VALUES (?::uuid,'personal',? ,?)",
                    spaceId, u, uid);
            db.update("INSERT INTO space_members(space_id, user_id, role) VALUES (?::uuid,?,'owner')", spaceId, uid);
            org.slf4j.LoggerFactory.getLogger("init").info("初始管理员 {} / {}", u, pwd);
        }
    }

    /** 空闲会话回收（FR-23）：>30 分钟未活跃的会话 → closing → 发 session_close 给 agentd（销毁沙箱）。 */
    @org.springframework.scheduling.annotation.Scheduled(fixedDelay = 300_000)
    public void reapIdleSessions() {
        try {
            var idle = db.queryForList(
                    "SELECT id::text FROM sessions WHERE status IN ('active','idle','created','sandbox_creating') " +
                    "AND last_active_at < now() - interval '30 minutes' LIMIT 20");
            for (var row : idle) {
                db.update("UPDATE sessions SET status='closing', closed_at=now() WHERE id=?::uuid", row.get("id"));
                post("http://" + System.getenv().getOrDefault("AGENTD_URL", "http://agentd:8000").replace("http://", "")
                                + "/internal/sessions/" + row.get("id") + "/cmd",
                        "{\"type\":\"session_close\",\"payload\":{}}");
                org.slf4j.LoggerFactory.getLogger("reaper").info("reaped idle session {}", row.get("id"));
            }
        } catch (Exception e) {
            org.slf4j.LoggerFactory.getLogger("reaper").warn("reap fail: {}", e.getMessage());
        }
    }

    private void post(String url, String json) {
        try {
            java.net.http.HttpClient.newHttpClient().send(
                    java.net.http.HttpRequest.newBuilder(java.net.URI.create(url.startsWith("http") ? url : "http://" + url))
                            .header("Content-Type", "application/json")
                            .POST(java.net.http.HttpRequest.BodyPublishers.ofString(json)).build(),
                    java.net.http.HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {}
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**")
                .addResourceLocations("classpath:/static/")
                .resourceChain(true)
                .addResolver(new PathResourceResolver() {
                    @Override
                    protected org.springframework.core.io.Resource getResource(String resourcePath, org.springframework.core.io.Resource location) throws java.io.IOException {
                        var requested = location.createRelative(resourcePath);
                        if (requested.exists() && requested.isReadable()) return requested;
                        var index = new ClassPathResource("/static/index.html");
                        return index.exists() ? index : null;
                    }
                });
    }
}
