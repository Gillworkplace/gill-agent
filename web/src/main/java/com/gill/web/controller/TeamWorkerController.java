package com.gill.web.controller;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.gill.web.service.TeamService;
import com.gill.web.service.CliDirectories;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Authenticated execution protocol. Credentials stay outside model and sandbox contexts. */
@RestController
@RequestMapping("/internal/team-worker")
public class TeamWorkerController {
    private final TeamService service;
    private final CliDirectories directories;
    private final byte[] secret;
    public TeamWorkerController(TeamService service,CliDirectories directories){
        this.service=service;this.directories=directories;
        this.secret=System.getenv().getOrDefault("GILL_TEAM_WORKER_SECRET","").getBytes(StandardCharsets.UTF_8);
    }
    private void authenticate(String token) {
        if(secret.length<32)throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE,"团队执行服务尚未配置");
        if(!MessageDigest.isEqual(secret,Objects.toString(token,"").getBytes(StandardCharsets.UTF_8)))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"无效执行身份");
    }
    @PostMapping("/claim")
    public Object claim(@RequestHeader(value="X-Team-Worker-Secret",required=false) String token,@RequestBody ObjectNode body){
        authenticate(token);
        boolean cli=directories.enabled();
        long owner=body.path("localOwnerId").asLong();
        if(owner>0&&!cli)throw new ResponseStatusException(HttpStatus.CONFLICT,"当前部署使用 Sandbox 执行，请使用 CLI 模式启动服务");
        String mode=owner>0?"cli":cli?"templates":"sandbox";
        var job=service.claim(body.path("workerId").asText(),mode,owner,body.path("localProjectId").asText(),
            body.path("localRunner").asText(),body.path("localBrowse").asBoolean());
        return job==null?Map.of():job;
    }
    @PostMapping("/directories")
    public Object directories(@RequestHeader(value="X-Team-Worker-Secret",required=false) String token,@RequestBody ObjectNode body){
        authenticate(token);return directories.exchange(body);
    }
    @PostMapping("/jobs/{id}/{operation}")
    public ObjectNode operate(@RequestHeader(value="X-Team-Worker-Secret",required=false) String token,
                              @PathVariable String id,@PathVariable String operation,@RequestBody ObjectNode body){
        authenticate(token);return service.worker(id,operation,body);
    }
}
