package com.gill.web.service.team;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import static com.gill.web.service.team.TeamData.text;

/** Relative paths and version manifests for a digital employee's files. */
public final class TemplateFiles {
    public static final int MAX_FILES = 128;
    public static final int MAX_FILE_BYTES = 8 * 1024 * 1024;
    public static final int MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
    public static final int MAX_INSTRUCTION_BYTES = 128 * 1024;

    private TemplateFiles() {}

    public static String relativePath(JsonNode entry) {
        String path = text(entry, "path");
        if (path.isBlank() || path.length() > 512 || path.indexOf('\\') >= 0 ||
            path.codePoints().anyMatch(Character::isISOControl) ||
            List.of(path.split("/", -1)).stream().anyMatch(p -> p.isBlank() || p.equals(".") || p.equals(".."))) {
            throw new IllegalArgumentException("INVALID_INPUT: 文件相对路径无效");
        }
        return path;
    }

    public static void validateManifest(JsonNode files) {
        if (!files.isArray() || files.size() > MAX_FILES) {
            throw new IllegalArgumentException("INVALID_INPUT: 模板最多可包含 128 个文件");
        }
        Set<String> paths = new HashSet<>();
        long bytes = 0, instructions = 0;
        for (JsonNode file : files) {
            String path = relativePath(file), purpose = text(file, "purpose");
            long size = file.path("size").asLong(-1);
            if (!paths.add(path) || size < 0 || size > MAX_FILE_BYTES ||
                !Set.of("prompt", "skill", "resource").contains(purpose)) {
                throw new IllegalArgumentException("INVALID_INPUT: 文件重复或文件用途、大小无效");
            }
            bytes += size;
            if (!purpose.equals("resource")) instructions += size;
        }
        for (String path : paths) {
            for (int slash = path.indexOf('/'); slash >= 0; slash = path.indexOf('/', slash + 1)) {
                if (paths.contains(path.substring(0, slash))) {
                    throw new IllegalArgumentException("INVALID_INPUT: 文件和目录的路径冲突");
                }
            }
        }
        if (bytes > MAX_PACKAGE_BYTES || instructions > MAX_INSTRUCTION_BYTES) {
            throw new IllegalArgumentException("INVALID_INPUT: 文件夹上限为 20 MB，指令与 Skills 文件合计上限为 128 KB");
        }
    }

    public static boolean hasInstructions(JsonNode files) {
        for (JsonNode file : files) {
            if (Set.of("prompt", "skill").contains(text(file, "purpose")) && file.path("size").asLong() > 0) return true;
        }
        return false;
    }
}
