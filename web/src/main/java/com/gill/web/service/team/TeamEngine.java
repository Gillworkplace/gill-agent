package com.gill.web.service.team;

import com.fasterxml.jackson.databind.node.ObjectNode;
import java.util.Set;
import static com.gill.web.service.team.TeamData.*;

/** Pure command entry point; application service owns atomic commit and identity. */
public final class TeamEngine {
    public ObjectNode apply(ObjectNode state,TeamActor actor,String kind,ObjectNode payload) {
        init(state);
        if(Set.of("version.record","integration.request","integration.result").contains(kind))return VersionPolicy.apply(state,actor,kind,payload);
        if(kind.equals("message.send"))return CommunicationPolicy.send(state,actor,payload);
        if(Set.of("task.assign","task.update","issue.escalate","decision.respond","run.control","artifact.save","check.record","run.complete","integration.request").contains(kind))
            return RuntimePolicy.apply(state,actor,kind,payload);
        return DefinitionPolicy.apply(state,actor,kind,payload);
    }
}
