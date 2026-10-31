package com.gill.web.security;

/** 哈希工具（D15：横切层，禁止依赖业务层——此前 sha256 放在 PatController 造成 security→controller 反向引用）。 */
public final class Hashes {
    private Hashes() {}

    public static String sha256(String s) {
        try {
            var md = java.security.MessageDigest.getInstance("SHA-256");
            byte[] d = md.digest(s.getBytes(java.nio.charset.StandardCharsets.UTF_8));
            var sb = new StringBuilder();
            for (byte b : d) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (java.security.NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }
}
