package com.gill.web.controller;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.gill.web.service.TeamService;
import org.springframework.web.bind.annotation.*;

/** User-authenticated team workspace protocol; business rules reside in TeamService. */
@RestController
@RequestMapping("/api/v1/team-workspace")
public class TeamController {
    private final TeamService service;
    private final com.gill.web.storage.TeamBlobStore blobs;
    public TeamController(TeamService service,com.gill.web.storage.TeamBlobStore blobs){this.service=service;this.blobs=blobs;}
    @GetMapping
    public ObjectNode read(@RequestAttribute("uid") Long uid){return service.read(uid);}
    @GetMapping("/skill-preview")
    public ObjectNode skillPreview(@RequestAttribute("uid") Long uid,@RequestParam String teamId,
                                   @RequestParam String employeeId,@RequestParam(defaultValue="") String taskId) {
        return service.skillPreview(uid,teamId,employeeId,taskId);
    }
    @PostMapping("/template-files")
    public ObjectNode uploadTemplateFiles(@RequestAttribute("uid") Long uid,@RequestBody ObjectNode body) {
        return service.uploadTemplateFiles(uid,body.path("files"));
    }
    @PostMapping("/commands")
    public ObjectNode command(@RequestAttribute("uid") Long uid,@RequestBody ObjectNode body){
        if(!body.path("payload").isObject())throw new IllegalArgumentException("INVALID_INPUT: payload必须为对象");
        return service.command(uid,body.path("requestKey").asText(),body.path("kind").asText(),(ObjectNode)body.get("payload"));
    }
    @GetMapping("/executions/{id}")
    public Object execution(@RequestAttribute("uid") Long uid,@PathVariable String id){return service.readExecution(uid,id);}
    @GetMapping("/object-url")
    public Object objectUrl(@RequestAttribute("uid") Long uid,@RequestParam String key){service.authorizeObject(uid,key);return java.util.Map.of("url",blobs.download(key));}
    @GetMapping("/events")
    public Object events(@RequestAttribute("uid") Long uid,@RequestParam(defaultValue="0") long after){return service.events(uid,after);}
}
