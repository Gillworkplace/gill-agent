package com.gill.web.ws;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import org.springframework.web.util.UriComponentsBuilder;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.*;

/** 浏览器 WS 网关：鉴权 → 会话归属校验 → 双向桥接 agentd（SSE 事件流 → WS 下发；WS 上行 → agentd cmd）。 */
@Component
public class AgentWebSocketHandler extends TextWebSocketHandler {
    private final JdbcTemplate db;
    private final ObjectMapper om = new ObjectMapper();
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final String agentdBase = System.getenv().getOrDefault("AGENTD_URL", "http://agentd:8000");
    private final Map<String, ScheduledExecutorService> pumps = new ConcurrentHashMap<>();
    private final Map<String, WebSocketSession> conns = new ConcurrentHashMap<>();

    public AgentWebSocketHandler(JdbcTemplate db) { this.db = db; }

    @Override
    public void afterConnectionEstablished(WebSocketSession ws) throws Exception {
        var q = UriComponentsBuilder.fromUri(ws.getUri()).build().getQueryParams();
        String token = q.getFirst("token");
        String sid = q.getFirst("sessionId");
        Long uid = auth(token);
        if (uid == null || sid == null || !owns(uid, sid)) { ws.close(CloseStatus.POLICY_VIOLATION); return; }
        conns.put(sid, ws);
        // 启动 agentd 会话运行时（携带元数据：用户/空间/项目标签/个人指令——知识库与注入依赖）+ 事件泵（SSE → WS）
        post("/internal/sessions/" + sid + "/start", metaJson(uid, sid));
        ScheduledExecutorService ex = Executors.newSingleThreadScheduledExecutor();
        pumps.put(sid, ex);
        final String sseUrl = agentdBase + "/internal/sessions/" + sid + "/events";
        ex.submit(() -> pumpSse(sseUrl, sid));
    }

    private String metaJson(Long uid, String sid) {
        try {
            var s = db.queryForMap("SELECT space_id::text, project_tag FROM sessions WHERE id=?::uuid", sid);
            var u = db.queryForMap("SELECT custom_instructions FROM users WHERE id=?", uid);
            var m = new java.util.HashMap<String, Object>();
            m.put("user_id", uid);
            m.put("space_id", s.get("space_id"));
            m.put("project_tag", s.get("project_tag"));
            m.put("custom_instructions", u.get("custom_instructions"));
            return om.writeValueAsString(java.util.Map.of("meta", m));
        } catch (Exception e) {
            return "{\"meta\":{}}";
        }
    }

    private void pumpSse(String url, String sid) {
        try {
            java.net.http.HttpRequest req = HttpRequest.newBuilder(URI.create(url)).GET().build();
            var body = http.send(req, HttpResponse.BodyHandlers.ofLines());
            body.body().forEach(line -> {
                if (line.startsWith("data: ")) {
                    send(sid, line.substring(6));
                }
            });
        } catch (Exception ignored) { /* 断开由清理任务回收 */ }
    }

    @Override
    protected void handleTextMessage(WebSocketSession ws, TextMessage msg) throws Exception {
        var q = UriComponentsBuilder.fromUri(ws.getUri()).build().getQueryParams();
        String sid = q.getFirst("sessionId");
        Long uid = auth(q.getFirst("token"));
        Map<String, Object> body = om.readValue(msg.getPayload(), Map.class);
        body.put("actor", uid);
        String type = String.valueOf(body.get("type"));
        // 消息入库（user 角色，简化）
        if ("user_input".equals(type)) {
            db.update("INSERT INTO messages(session_id, seq, role, content, actor_user_id) " +
                    "SELECT ?::uuid, COALESCE(MAX(seq),0)+1, 'user', ?, ? FROM messages WHERE session_id=?::uuid",
                    sid, String.valueOf(((Map) body.get("payload")).get("text")), uid, sid);
        }
        post("/internal/sessions/" + sid + "/cmd", om.writeValueAsString(body));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession ws, CloseStatus status) {
        var q = UriComponentsBuilder.fromUri(ws.getUri()).build().getQueryParams();
        String sid = q.getFirst("sessionId");
        if (sid != null) {
            var ex = pumps.remove(sid);
            if (ex != null) ex.shutdownNow();
            conns.remove(sid);
        }
    }

    private void send(String sid, String json) {
        try {
            WebSocketSession ws = conns.get(sid);
            if (ws != null && ws.isOpen()) synchronized (ws) { ws.sendMessage(new TextMessage(json)); }
        } catch (Exception ignored) {}
    }

    private void post(String path, String json) {
        try {
            http.send(HttpRequest.newBuilder(URI.create(agentdBase + path))
                    .header("Content-Type", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(json)).build(), HttpResponse.BodyHandlers.discarding());
        } catch (Exception ignored) {}
    }

    private Long auth(String token) {
        if (token == null) return null;
        // JWT 直查数据库太重；解析 sub（无验签的快速路径有风险，走标准解析由 Filter 复用逻辑）
        try {
            var claims = com.gill.web.WsAuthBridge.parse(token);
            return claims;
        } catch (Exception e) { return null; }
    }

    private boolean owns(long uid, String sid) {
        List<Map<String, Object>> rows = db.queryForList(
                "SELECT 1 FROM sessions s JOIN space_members sm ON sm.space_id=s.space_id AND sm.user_id=? WHERE s.id=?::uuid",
                uid, sid);
        return !rows.isEmpty();
    }
}
