package com.gill.web;

import com.gill.web.config.GillProperties;
import com.gill.web.security.JwtUtil;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;

/** WS 路由注册 + 静态前端托管（SPA fallback）。 */
@Configuration
@EnableWebSocket
public class WsConfig implements WebSocketConfigurer {
    private final com.gill.web.ws.AgentWebSocketHandler handler;
    public static JwtUtil JWT;

    public WsConfig(com.gill.web.ws.AgentWebSocketHandler handler, GillProperties props) {
        this.handler = handler;
        JWT = new JwtUtil(props.jwtSecret(), props.jwtTtlHours());
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/ws/agent").setAllowedOrigins("*");
    }
}
