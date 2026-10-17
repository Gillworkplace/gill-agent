package com.gill.web.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
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
