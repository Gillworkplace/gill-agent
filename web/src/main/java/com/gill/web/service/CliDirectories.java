package com.gill.web.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.stereotype.Service;

import java.util.*;
import java.util.concurrent.*;

import static com.gill.web.service.team.TeamData.*;

/** Live directory requests for CLI hosts. Project bindings persist in the team workspace. */
@Service
public class CliDirectories {
    private static final long ONLINE_MS = 12_000;
    private static final long SELECTION_MS = 600_000;
    private final Map<Root, Runner> runners = new HashMap<>();

    private record Root(long owner, String id) {}
    private record Listing(List<String> children, boolean hasGit) {}
    private record Selection(long time, boolean hasGit) {}
    private record Request(String id, String path, CompletableFuture<Listing> result) {}
    private static final class Runner {
        String label;
        long seen;
        Request pending;
        final Map<String, Selection> selections = new LinkedHashMap<>();
    }

    public boolean enabled() {
        return "cli".equals(System.getenv().getOrDefault("GILL_TEAM_EXECUTOR", "sandbox"));
    }

    public synchronized Map<String, Object> list(long owner) {
        prune();
        var available = runners.entrySet().stream().filter(entry -> entry.getKey().owner() == owner)
            .map(entry -> Map.of("rootId", entry.getKey().id(), "label", entry.getValue().label))
            .sorted(Comparator.comparing(entry -> entry.get("label"))).toList();
        return Map.of("enabled", enabled(), "runners", available);
    }

    public synchronized Map<String, String> exchange(ObjectNode input) {
        requireEnabled();
        long owner = input.path("localOwnerId").asLong();
        String label = required(input, "label");
        if (owner <= 0 || !label.startsWith("/") || label.length() > 4096 || label.chars().anyMatch(Character::isISOControl))
            throw new IllegalArgumentException("INVALID_INPUT: CLI 目录标识无效");
        Root key = new Root(owner, rootId(input, "rootId"));
        prune();
        Runner runner = runners.computeIfAbsent(key, ignored -> new Runner());
        runner.label = label;
        runner.seen = System.currentTimeMillis();
        Request request = runner.pending;
        if (request == null) return Map.of();
        JsonNode reply = input.path("reply");
        if (!request.id().equals(text(reply, "id"))) return Map.of("id", request.id(), "path", request.path());
        if (reply.path("children").isArray() && reply.path("children").size() <= 2000 && reply.path("hasGit").isBoolean()) {
            List<String> children = new ArrayList<>();
            for (JsonNode child : reply.path("children")) {
                if (child.isTextual() && validSegment(child.asText())) children.add(child.asText());
            }
            boolean git = reply.path("hasGit").asBoolean();
            runner.selections.put(request.path(), new Selection(runner.seen, git));
            if (runner.selections.size() > 128) runner.selections.remove(runner.selections.keySet().iterator().next());
            request.result().complete(new Listing(children, git));
        } else {
            request.result().completeExceptionally(new IllegalArgumentException("INVALID_INPUT: CLI 无法读取此目录，请返回上一级重试"));
        }
        runner.pending = null;
        return Map.of();
    }

    public Map<String, Object> browse(long owner, ObjectNode input) {
        requireEnabled();
        Root key = new Root(owner, rootId(input, "rootId"));
        String path = relativePath(input);
        Request request = new Request(id(), path, new CompletableFuture<>());
        Runner runner;
        synchronized (this) {
            runner = online(key);
            if (runner.pending != null) throw new IllegalArgumentException("BUSY: CLI 正在读取另一个目录，请稍后重试");
            runner.pending = request;
        }
        try {
            Listing listing = request.result().get(8, TimeUnit.SECONDS);
            return Map.of("path", path, "children", listing.children(), "hasGit", listing.hasGit());
        } catch (ExecutionException error) {
            throw (IllegalArgumentException) error.getCause();
        } catch (TimeoutException error) {
            throw offline();
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw offline();
        } finally {
            synchronized (this) {
                if (runner.pending == request) runner.pending = null;
            }
        }
    }

    public synchronized ObjectNode selected(long owner, JsonNode selection) {
        requireEnabled();
        String rootId = rootId(selection, "rootId"), path = relativePath(selection);
        Runner runner = online(new Root(owner, rootId));
        Selection received = runner.selections.get(path);
        if (received == null || received.time() < System.currentTimeMillis() - SELECTION_MS)
            throw new IllegalArgumentException("VERSION_CONFLICT: 请重新打开目录选择器确认目录");
        String label = path.isEmpty() ? runner.label : (runner.label.equals("/") ? "/" : runner.label + "/") + path;
        return node("rootId", rootId, "path", path, "label", label).put("hasGit", received.hasGit());
    }

    private Runner online(Root key) {
        prune();
        Runner runner = runners.get(key);
        if (runner == null) throw offline();
        return runner;
    }

    private void prune() {
        long cutoff = System.currentTimeMillis() - ONLINE_MS;
        runners.values().removeIf(runner -> runner.pending == null && runner.seen < cutoff);
    }

    private void requireEnabled() {
        if (!enabled()) throw new IllegalArgumentException("INVALID_STATE: 本地目录只在 CLI 模式可用");
    }

    private static IllegalArgumentException offline() {
        return new IllegalArgumentException("BUSY: CLI 未响应，请确认执行器在线后重试");
    }

    private static String rootId(JsonNode object, String field) {
        String value = text(object, field);
        if (!value.matches("[a-f0-9]{24}")) throw new IllegalArgumentException("INVALID_INPUT: 无效 CLI 目录标识");
        return value;
    }

    private static String relativePath(JsonNode object) {
        String path = text(object, "path");
        if (!object.path("path").isTextual() || path.length() > 4096 ||
            (!path.isEmpty() && Arrays.stream(path.split("/", -1)).anyMatch(part -> !validSegment(part))))
            throw new IllegalArgumentException("INVALID_INPUT: 无效的 CLI 相对目录");
        return path;
    }

    private static boolean validSegment(String value) {
        return !value.isEmpty() && !value.startsWith(".") && value.indexOf('/') < 0 && value.indexOf('\\') < 0 &&
            value.indexOf(',') < 0 && value.indexOf('"') < 0 && value.chars().noneMatch(Character::isISOControl);
    }
}
