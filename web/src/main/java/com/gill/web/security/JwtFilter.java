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
        if (token == null) { deny(res, "AUTH-1004", 401); return; }
        try {
            var claims = jwt.parse(token);
            long uid = jwt.userId(claims);
            // 禁用即失效（FR-13）
            String status;
            try (var st = ds.getConnection().prepareStatement("SELECT status FROM users WHERE id=?")) {
                st.setLong(1, uid);
                var rs = st.executeQuery();
                status = rs.next() ? rs.getString(1) : null;
            }
            if (!"ACTIVE".equals(status)) { deny(res, "AUTH-1005", 401); return; }
            req.setAttribute("uid", uid);
            req.setAttribute("role", jwt.role(claims));
            chain.doFilter(req, res);
        } catch (Exception e) {
            deny(res, "AUTH-1004", 401);
        }
    }

    private void deny(HttpServletResponse res, String code, int status) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json;charset=utf-8");
        res.getWriter().write("{\"error\":{\"code\":\"" + code + "\",\"message\":\"登录已过期或无效\"}}");
    }

    public JwtUtil util() { return jwt; }
}
