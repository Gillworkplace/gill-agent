package com.gill.web;

/** WS 握手鉴权桥（复用 JwtUtil）。 */
public class WsAuthBridge {
    public static Long parse(String token) {
        var c = WsConfig.JWT.parse(token);
        return Long.parseLong(c.getSubject());
    }
}
