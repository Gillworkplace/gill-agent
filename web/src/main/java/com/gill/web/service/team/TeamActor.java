package com.gill.web.service.team;

/** Identity derived from authenticated user or leased execution, never model arguments. */
public record TeamActor(String type, String id, String teamId) {
    public boolean human() { return "user".equals(type); }
}
