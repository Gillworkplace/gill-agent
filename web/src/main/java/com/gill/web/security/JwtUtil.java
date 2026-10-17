package com.gill.web.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;

/** JWT 签发与校验（HS256，claims: sub/role/exp/iat/jti）。 */
public class JwtUtil {
    private final SecretKey key;
    private final long ttlHours;

    public JwtUtil(String secret, long ttlHours) {
        this.key = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        this.ttlHours = ttlHours;
    }

    public String issue(long userId, String role) {
        Date now = new Date();
        return Jwts.builder().subject(String.valueOf(userId)).claim("role", role)
                .issuedAt(now).expiration(new Date(now.getTime() + ttlHours * 3600_000))
                .id(java.util.UUID.randomUUID().toString()).signWith(key).compact();
    }

    public Claims parse(String token) {
        return Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();
    }

    public long userId(Claims c) { return Long.parseLong(c.getSubject()); }
    public String role(Claims c) { return String.valueOf(c.get("role")); }
}
