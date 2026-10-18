package com.gill.web.security;

import com.gill.web.config.GillProperties;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.Map;

/** REST 鉴权过滤器：/api/v1/** 需 JWT；/api/v1/auth/**、/actuator、静态资源放行。 */
@Configuration
public class JwtFilter extends OncePerRequestFilter {
    private final JwtUtil jwt;
    private final javax.sql.DataSource ds;

    public JwtFilter(GillProperties props, javax.sql.DataSource ds) {
        this.jwt = new JwtUtil(props.jwtSecret(), props.jwtTtlHours());
        this.ds = ds;
    }

    @Bean
    public JwtUtil jwtUtil(GillProperties props) { return new JwtUtil(props.jwtSecret(), props.jwtTtlHours()); }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String path = req.getRequestURI();
        boolean open = path.startsWith("/api/v1/auth/register") || path.startsWith("/api/v1/auth/login")
                || path.startsWith("/actuator") || path.startsWith("/ws/") || !path.startsWith("/api/");
        if (open) { chain.doFilter(req, res); return; }
        String auth = req.getHeader("Authorization");
        String token = auth != null && auth.startsWith("Bearer ") ? auth.substring(7) : null;
        if (token == null) token = req.getParameter("token");
        if (token == null) { System.err.println("[JWT] null token for " + path); deny(res, "AUTH-1004", 401); return; }
        try {
            Long uid = null;
            String role = null;
            if (token.startsWith("gpat_")) {                 // PAT：哈希比对（FR-16）
                try (var conn = ds.getConnection()) {
                    var rows = conn.createStatement().executeQuery(
                            "SELECT user_id FROM pats WHERE token_hash='" + com.gill.web.controller.PatController.sha256(token).replace("'", "") + "' AND revoked=false");
                    if (rows.next()) {
                        uid = rows.getLong(1);
                        role = "USER";
                        try (var st = conn.prepareStatement("UPDATE pats SET last_used_at=now() WHERE token_hash=?")) {
                            st.setString(1, com.gill.web.controller.PatController.sha256(token));
                            st.executeUpdate();
                        }
                    }
                }
            } else {
                var claims = jwt.parse(token);
                uid = jwt.userId(claims);
                role = jwt.role(claims);
            }
            if (uid == null) { deny(res, "AUTH-1006", 401); return; }
            // ---- 限流（FR-85 简化内存版：60 req/min/user；多副本时换 Redis）----
            if (!RateLimit.allow(uid)) { deny(res, "QUOTA-429", 429); return; }
            // 禁用即失效（FR-13）
            String status;
            try (var conn = ds.getConnection();
                 var st = conn.prepareStatement("SELECT status FROM users WHERE id=?")) {
                st.setLong(1, uid);
                var rs = st.executeQuery();
                status = rs.next() ? rs.getString(1) : null;
            }
            if (!"ACTIVE".equals(status)) { deny(res, "AUTH-1005", 401); return; }
            req.setAttribute("uid", uid);
            req.setAttribute("role", role);
        } catch (Exception e) {
            // 仅认证环节异常才判 401；下游控制器异常在 filter 外抛出，交 Spring 返回 500，不得伪装成登录失效
            System.err.println("[JWT] parse fail " + path + " : " + e);
            deny(res, "AUTH-1004", 401);
            return;
        }
        chain.doFilter(req, res);
    }

    /** 每用户滑动窗口限流（单副本内存实现）。 */
    static class RateLimit {
        private static final java.util.Map<Long, java.util.Deque<Long>> HITS = new java.util.concurrent.ConcurrentHashMap<>();
        static boolean allow(long uid) {
            long now = System.currentTimeMillis();
            var q = HITS.computeIfAbsent(uid, k -> new java.util.concurrent.ConcurrentLinkedDeque<>());
            while (!q.isEmpty() && now - q.peekFirst() > 60_000) q.pollFirst();
            if (q.size() >= 60) return false;
            q.addLast(now);
            return true;
        }
    }

    private void deny(HttpServletResponse res, String code, int status) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=utf-8");
        res.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"登录已过期或无效\"}}");
    }

    public JwtUtil util() { return jwt; }
}
