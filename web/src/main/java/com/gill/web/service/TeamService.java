package com.gill.web.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.*;
import com.gill.web.repo.TeamMapper;
import com.gill.web.service.team.*;
import com.gill.web.storage.TeamBlobStore;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;
import static com.gill.web.service.team.TeamData.*;

/** Transaction boundary for authenticated workspace commands and leased worker results. */
@Service
public class TeamService {
    private final TeamMapper db;
    private final ObjectMapper json;
    private final TeamBlobStore blobs;
    private final CliDirectories directories;
    private final TeamEngine engine=new TeamEngine();
    public TeamService(TeamMapper db,ObjectMapper json,TeamBlobStore blobs,CliDirectories directories) {
        this.db=db;this.json=json;this.blobs=blobs;this.directories=directories;
    }

    public ObjectNode read(long uid) {
        var row=db.selectById(uid);
        ObjectNode s=row==null?json.createObjectNode():parse(row.document);init(s);
        s.put("revision",row==null?0:row.revision);s.remove("pending");
        if(row!=null&&row.updatedAt!=null)s.put("updatedAt",row.updatedAt.toString());
        for(Map<String,Object> job:db.jobStates(uid)){String taskId=Objects.toString(job.get("task_id"),"");
            if(!map(s,"tasks").has(taskId))continue;ObjectNode task=get(s,"tasks",taskId);
            task.put("executionId",Objects.toString(job.get("job_id"),"")).put("sandboxId",Objects.toString(job.get("sandbox_id"),""));
            String status=Objects.toString(job.get("state"),"");
            if(status.equals("needs_reconciliation")||(status.equals("running")&&!Boolean.TRUE.equals(job.get("lease_valid"))))
                projectUnknownExecution(s,task,job,status.equals("needs_reconciliation")?status:"unknown");
        }
        return s;
    }
    private void projectUnknownExecution(ObjectNode s,ObjectNode task,Map<String,Object> job,String state) {
        task.put("state",state);
        ObjectNode run=get(s,"runs",text(task,"runId"));
        if(!text(run,"state").equals("needs_reconciliation"))run.put("state",state);
        String integrationId=Objects.toString(job.get("integration_id"),"");
        JsonNode integration=map(s,"integrations").path(integrationId);
        if(integration instanceof ObjectNode record&&text(record,"state").equals("queued"))record.put("state",state);
    }
    public List<Map<String,Object>> events(long uid,long after) {return db.events(uid,after);}

    public ObjectNode skillPreview(long uid,String teamId,String employeeId,String taskId) {
        var row=db.selectById(uid);
        ObjectNode state=row==null?json.createObjectNode():parse(row.document);
        return engine.skillPreview(state,teamId,employeeId,taskId);
    }

    public ObjectNode uploadTemplateFiles(long uid,JsonNode files) {
        if(!files.isArray()||files.isEmpty()||files.size()>TemplateFiles.MAX_FILES)
            throw new IllegalArgumentException("INVALID_INPUT: 请选择 1 到 128 个文件");
        Map<String,byte[]> contents=new LinkedHashMap<>();
        int total=0;
        for(JsonNode item:files) {
            String path=TemplateFiles.relativePath(item);
            JsonNode encoded=item.path("data");
            if(!encoded.isTextual()||encoded.textValue().length()>4*((TemplateFiles.MAX_FILE_BYTES+2)/3))
                throw new IllegalArgumentException("INVALID_INPUT: 单个文件上限为 8 MB");
            byte[] data;
            try {data=Base64.getDecoder().decode(encoded.textValue());}
            catch(IllegalArgumentException error){throw new IllegalArgumentException("INVALID_INPUT: 文件编码无效");}
            total+=data.length;
            if(data.length>TemplateFiles.MAX_FILE_BYTES||total>TemplateFiles.MAX_PACKAGE_BYTES||contents.putIfAbsent(path,data)!=null)
                throw new IllegalArgumentException("INVALID_INPUT: 重复路径或文件大小超限");
        }
        ObjectNode result=node();
        ArrayNode manifest=result.putArray("files");
        contents.forEach((path,data)->{
            var blob=blobs.saveTemplateFile(uid,data);
            manifest.add(node("path",path,"key",blob.key()).put("size",blob.size()).put("utf8",blob.utf8()));
        });
        return result;
    }

    private void verifyTemplateFiles(long uid,JsonNode files) {
        TemplateFiles.validateManifest(files);
        Map<String,TeamBlobStore.TemplateBlob> verified=new HashMap<>();
        for(JsonNode file:files) {
            String key=required(file,"key");
            var blob=verified.computeIfAbsent(key,ref->blobs.templateFile(uid,ref));
            if(blob.size()!=file.path("size").asLong()||
                (!text(file,"purpose").equals("resource")&&(!blob.utf8()||blob.size()==0)))
                throw new IllegalArgumentException("INVALID_INPUT: 指令和 Skill 需要非空 UTF-8 文件，文件大小需与上传一致");
            ((ObjectNode)file).put("utf8",blob.utf8()).retain("path","purpose","key","size","utf8");
        }
    }

    @Transactional
    public ObjectNode command(long uid,String key,String kind,ObjectNode payload) {
        if(Set.of("integration.result","version.record").contains(kind))
            throw new IllegalArgumentException("SCOPE_FORBIDDEN: 版本与集成结果由实际执行器提交");
        if(Set.of("team.create","team.update","employee.create","employee.update","role.save","orgTemplate.save").contains(kind)&&payload.has("promptFiles"))
            verifyTemplateFiles(uid,payload.path("promptFiles"));
        return execute(uid,new TeamActor("user",Long.toString(uid),null),key,kind,payload);
    }
    private ObjectNode execute(long uid,TeamActor actor,String key,String kind,ObjectNode payload) {
        if(key==null||key.isBlank()||key.length()>100)throw new IllegalArgumentException("INVALID_INPUT: 缺少有效requestKey");
        ObjectNode s=locked(uid);
        String scoped=actor.type()+":"+actor.id()+":"+key;
        String hash=hash(kind+"\n"+canonical(payload));
        Map<String,Object> prior=db.request(uid,scoped);
        if(prior!=null) {
            if(!hash.equals(prior.get("request_hash")))throw new IllegalArgumentException("IDEMPOTENCY_CONFLICT: 相同请求标识的内容不同");
            return parse(prior.get("result"));
        }
        if(kind.equals("project.save")&&actor.human()&&payload.hasNonNull("localDirectory")) {
            payload=payload.deepCopy();
            payload.set("localDirectory",directories.selected(uid,payload.get("localDirectory")));
        }
        if(kind.equals("task.update")&&payload.has("employeeId")&&db.runningTask(uid,required(payload,"taskId"))>0)throw new IllegalArgumentException("BUSY: 任务仍在执行，请先阻断并等待当前调用结束后改派");
        if((Set.of("run.complete","integration.request").contains(kind)||(kind.equals("task.update")&&
            (payload.has("employeeId")||Set.of("queued","completed").contains(text(payload,"state")))))&&db.unresolvedTask(uid,required(payload,"taskId"))>0)
            throw new IllegalArgumentException("ACTION_RESULT_UNKNOWN: 请先核实尚未确认的外部动作");
        ObjectNode result=kind.equals("execution.reconcile")?reconcile(uid,s,actor,payload):engine.apply(s,actor,kind,payload);
        if(Set.of("team.delete","employee.delete","project.delete").contains(kind)&&
            db.resourceHasActiveJobs(uid,kind,required(result,"id")))
            throw new IllegalArgumentException("BUSY: 仍有相关执行或未核实结果，请等待执行收尾后再删除");
        if(kind.equals("run.control")) {
            String runId=required(payload,"runId"),op=required(payload,"operation");
            if(op.equals("resume"))resumePaused(uid,s,runId);
            else if(db.running(uid,runId)==0){ObjectNode run=get(s,"runs",runId);run.put("state",op.equals("pause")?"paused":"stopped");result.put("state",text(run,"state"));}
        }
        persist(uid,s,kind,result,text(payload,"teamId"));
        db.saveRequest(uid,scoped,hash,result.toString());return result;
    }
    private ObjectNode locked(long uid) {
        db.ensureWorkspace(uid);Map<String,Object> row=db.lockWorkspace(uid);
        ObjectNode s=parse(row.get("document"));init(s);return s;
    }
    private void persist(long uid,ObjectNode s,String kind,ObjectNode result,String tid) {
        for(JsonNode job:list(s,"pending")) {
            if(text(job,"kind").equals("turn")&&!canSchedule(uid,s,get(s,"tasks",text(job,"taskId"))))continue;
            db.enqueue(required(job,"id"),uid,text(job,"teamId"),job.toString());
        }
        s.set("pending",json.createArrayNode());db.saveWorkspace(uid,s.toString());
        for(JsonNode n:map(s,"tasks")) {
            ObjectNode task=(ObjectNode)n;
            if(!canSchedule(uid,s,task))continue;
            ObjectNode job=node("id",id(),"kind","turn","teamId",text(task,"teamId"),"employeeId",text(task,"employeeId"),"taskId",text(task,"id"),"runId",text(task,"runId"));
            job.put("generation",TaskFlow.generation(task));
            if(task.has("sourceDeliveryId"))job.put("deliveryId",text(task,"sourceDeliveryId"));
            db.enqueue(text(job,"id"),uid,text(job,"teamId"),job.toString());
        }
        db.event(uid,tid,kind,result.toString());
    }
    private boolean canSchedule(long uid,ObjectNode s,ObjectNode task) {
        ObjectNode run=get(s,"runs",text(task,"runId"));
        return text(task,"state").equals("queued")&&!run.path("manualPaused").asBoolean()&&
            !Set.of("waiting","needs_reconciliation","stopped","stop_requested").contains(text(run,"state"))&&
            TaskFlow.blockingDecision(s,task).isBlank()&&db.unresolvedTask(uid,text(task,"id"))==0&&
            db.scheduledTask(uid,text(task,"id"),TaskFlow.generation(task))==0;
    }
    private void resumePaused(long uid,ObjectNode s,String run) {
        for(Map<String,Object> job:db.jobStates(uid)) {
            String taskId=Objects.toString(job.get("task_id"),"");
            if(!map(s,"tasks").has(taskId)||!"paused".equals(job.get("state")))continue;
            ObjectNode task=get(s,"tasks",taskId);
            if(!run.equals(text(task,"runId"))||!Set.of("paused","queued").contains(text(task,"state"))||
                !TaskFlow.blockingDecision(s,task).isBlank()||db.unresolvedTask(uid,taskId)>0)continue;
            db.resumeTask(uid,taskId,TaskFlow.generation(task));task.put("state","queued");
        }
    }
    public Map<String,Object> claim(String worker) {
        return claim(worker,"sandbox",0,"","");
    }
    public Map<String,Object> claim(String worker,String mode,long owner,String project,String runner) {
        return claim(worker,mode,owner,project,runner,false);
    }
    public Map<String,Object> claim(String worker,String mode,long owner,String project,String runner,boolean browse) {
        if(worker==null||!worker.matches("[a-zA-Z0-9._-]{1,100}"))throw new IllegalArgumentException("INVALID_INPUT: 无效workerId");
        if(!Set.of("sandbox","templates","cli").contains(mode)||("cli".equals(mode)&&(owner<=0||!runner.matches("[0-9a-f]{24}")||
            (!project.isEmpty()&&!project.matches("[a-f0-9-]{36}"))))||(browse&&(!mode.equals("cli")||!project.isEmpty())))
            throw new IllegalArgumentException("INVALID_INPUT: 无效 CLI 工作区绑定");
        db.reconcileExpired();return db.claim(worker,mode,owner,project,runner,browse);
    }
    private Map<String,Object> leased(String id,ObjectNode input) {
        Map<String,Object> job=db.job(id);
        if(job==null)throw new IllegalArgumentException("NOT_FOUND: 执行实例不存在");
        if(!Objects.equals(job.get("worker_id"),text(input,"workerId"))||
            ((Number)job.get("fence")).longValue()!=input.path("fence").asLong(-1)||
            !Boolean.TRUE.equals(job.get("lease_valid"))||!"running".equals(job.get("state")))
            throw new IllegalArgumentException("LEASE_LOST: 执行租约已失效");
        return job;
    }
    @Transactional
    public ObjectNode worker(String id,String operation,ObjectNode input) {
        if(operation.equals("late-result"))return lateResult(id,input);
        Map<String,Object> job=leased(id,input);
        long uid=((Number)job.get("owner_user_id")).longValue();
        ObjectNode s=locked(uid);job=leased(id,input);
        ObjectNode payload=parse(job.get("payload"));
        String tid=text(payload,"teamId");
        ObjectNode result=switch(operation) {
            case "context" -> context(s,job,payload);
            case "heartbeat" -> heartbeat(id,input,s,payload);
            case "checkpoint" -> checkpoint(id,input);
            case "sandbox" -> sandbox(id,input);
            case "command" -> workerCommand(uid,s,payload,id,input);
            case "action" -> beginAction(s,id,payload,input);
            case "action-result" -> actionResult(s,id,payload,input);
            case "finish" -> finish(s,id,payload,input,uid);
            default -> throw new IllegalArgumentException("UNSUPPORTED_ACTION: "+operation);
        };
        // Commands already persist their exact idempotent result inside execute.
        if(!operation.equals("command"))persist(uid,s,"worker."+operation,node("jobId",id,"state",text(result,"state")),tid);
        return result;
    }
    private ObjectNode heartbeat(String id,ObjectNode input,ObjectNode s,ObjectNode p) {
        if(db.renew(id,text(input,"workerId"),input.path("fence").asLong())!=1)throw new IllegalArgumentException("LEASE_LOST: 续期失败");
        ObjectNode result=node("state","running");
        if(p.has("runId")) {
            ObjectNode run=get(s,"runs",text(p,"runId"));
            result.put("state",text(run,"state")).put("controlRevision",run.path("controlRevision").asInt());
            ObjectNode task=get(s,"tasks",text(p,"taskId"));result.put("taskState",text(task,"state"));
            if(text(p,"kind").equals("turn")&&!TaskFlow.current(task,p))result.put("state","paused");
            String waiting=TaskFlow.blockingDecision(s,task);
            if(!waiting.isBlank())result.put("taskState","blocked").put("waitingDecisionId",waiting);
        }
        return result;
    }
    private ObjectNode checkpoint(String id,ObjectNode input) {
        db.checkpoint(id,input.path("checkpoint").toString());return node("state","saved");
    }
    private ObjectNode sandbox(String id,ObjectNode input) {
        db.sandbox(id,required(input,"sandboxId"));return node("state","saved");
    }
    private ObjectNode context(ObjectNode s,Map<String,Object> job,ObjectNode p) {
        ObjectNode out=p.deepCopy();out.put("jobId",job.get("id").toString());
        out.set("checkpoint",parse(job.get("checkpoint")));out.put("sandboxId",Objects.toString(job.get("sandbox_id"),""));
        if(text(p,"kind").equals("template")) {out.set("draft",get(s,"drafts",text(p,"draftId")).deepCopy());return out;}
        ObjectNode task=get(s,"tasks",required(p,"taskId"));
        ObjectNode run=get(s,"runs",required(p,"runId"));ObjectNode employee=get(s,"employees",required(p,"employeeId"));
        if(!text(task,"teamId").equals(text(employee,"teamId")))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 任务身份不匹配");
        out.set("task",task.deepCopy());out.set("run",run.deepCopy());
        out.set("employee",task.path("employeeSnapshot").deepCopy());out.set("team",task.path("teamSnapshot").deepCopy());
        if(task.path("roleSnapshot").isObject())out.set("teamRole",task.path("roleSnapshot").deepCopy());
        ArrayNode sources=out.putArray("knowledge");
        ObjectNode retained=map(task,"retainedKnowledge");
        for(JsonNode source:list(employee,"knowledgeIds")) {
            ObjectNode knowledge=get(s,"knowledge",source.asText());sources.add(knowledge.deepCopy().without("versions"));
            retained.set(source.asText(),knowledge.deepCopy().without("versions"));
            ObjectNode read=node("sourceId",source.asText(),"readAt",now()).put("revision",knowledge.path("revision").asInt());
            list(task,"knowledgeReads").add(read);
        }
        out.set("retainedKnowledge",retained.deepCopy());
        ArrayNode peers=out.putArray("peers");
        for(JsonNode e:map(s,"employees")) {
            if(!text(e,"teamId").equals(text(task,"teamId")))continue;
            JsonNode role=map(s,"teamRoles").path(text(e,"roleId"));
            peers.add(node("id",text(e,"id"),"name",text(e,"name"),"role",text(e,"role"),
                "teamRole",text(role,"name"),"parentId",text(e,"parentId")));
        }
        ArrayNode msgs=out.putArray("messages");String runId=text(run,"id");
        for(JsonNode m:map(s,"messages"))if(text(m,"teamId").equals(text(task,"teamId"))&&
            (text(m,"runId").equals(runId)||text(m,"id").equals(text(task,"sourceMessageId"))))msgs.add(m.deepCopy());
        while(msgs.size()>40)msgs.remove(0);
        if(task.has("assessmentDecisionId"))out.set("decision",get(s,"decisions",text(task,"assessmentDecisionId")).deepCopy());
        if(task.has("decisionId"))out.set("decision",get(s,"decisions",text(task,"decisionId")).deepCopy());
        ObjectNode wi=get(s,"workItems",text(run,"workItemId"));String project=text(wi,"projectId");
        if(wi.path("requireDispatchApproval").asBoolean())
            out.put("dispatchApprovalPending",TaskFlow.needsDispatchApproval(s,task));
        if(!project.isBlank())out.set("project",wi.has("projectSnapshot")?wi.path("projectSnapshot").deepCopy():get(s,"projects",project).deepCopy());
        if(text(p,"kind").equals("integration")){
            ObjectNode request=get(s,"integrations",text(p,"integrationId"));
            out.set("integration",request.deepCopy());
            out.set("sourceVersion",get(s,"codeVersions",text(request,"sourceVersionId")).deepCopy());
            ObjectNode currentProject=get(s,"projects",text(request,"projectId")).deepCopy();
            JsonNode boundDirectory=wi.path("projectSnapshot").get("localDirectory");
            if(boundDirectory==null)currentProject.remove("localDirectory");
            else currentProject.set("localDirectory",boundDirectory.deepCopy());
            out.set("project",currentProject);
        }
        ArrayNode artifacts=out.putArray("artifacts");
        for(JsonNode artifact:map(s,"artifacts")) {
            JsonNode sourceTask=map(s,"tasks").path(text(artifact,"taskId"));
            if(text(artifact,"teamId").equals(text(task,"teamId"))&&text(sourceTask,"runId").equals(runId))
                artifacts.add(((ObjectNode)artifact).deepCopy().without("versions"));
        }
        return out;
    }
    private ObjectNode workerCommand(long uid,ObjectNode s,ObjectNode p,String job,ObjectNode input) {
        String kind=required(input,"kind");ObjectNode body=(ObjectNode)input.path("payload").deepCopy();
        if(text(p,"kind").equals("template")&&!kind.equals("draft.generated"))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 模板生成器仅可保存草稿");
        if(!text(p,"kind").equals("template")) {
            if(kind.equals("run.control")||kind.equals("employee.create")||kind.equals("knowledge.save"))throw new IllegalArgumentException("SCOPE_FORBIDDEN: 员工无权执行");
            if(!body.has("teamId"))body.put("teamId",text(p,"teamId"));
            if(!body.has("taskId"))body.put("taskId",text(p,"taskId"));
            if(kind.equals("integration.result")&&(!text(p,"kind").equals("integration")||
                !required(p,"integrationId").equals(required(body,"integrationId"))))
                throw new IllegalArgumentException("SCOPE_FORBIDDEN: 只能提交当前集成执行的结果");
            if(Set.of("document.save","message.send","task.assign","issue.escalate","integration.request").contains(kind)&&!text(body,"taskId").equals(text(p,"taskId")))
                throw new IllegalArgumentException("SCOPE_FORBIDDEN: 此动作必须使用当前执行任务");
            ObjectNode run=get(s,"runs",text(p,"runId"));
            ObjectNode task=get(s,"tasks",text(p,"taskId"));
            if(text(p,"kind").equals("turn")&&!TaskFlow.current(task,p)&&!Set.of("version.record","integration.result").contains(kind))
                throw new IllegalArgumentException("VERSION_CONFLICT: 原执行的调度版本已失效");
            boolean communication=kind.equals("message.send")&&Set.of("notify","review","").contains(text(body,"intent"));
            if(!TaskFlow.blockingDecision(s,task).isBlank()&&!Set.of("decision.respond","issue.escalate","version.record","integration.result","artifact.save","check.record").contains(kind)&&!communication)
                throw new IllegalArgumentException("DEPENDENCY_UNRESOLVED: 相关事项等待明确决定");
            if(run.path("manualPaused").asBoolean()&&!Set.of("version.record","integration.result").contains(kind))throw new IllegalArgumentException("PAUSED: 团队目标已暂停");
        }
        TeamActor actor=text(p,"kind").equals("template")?new TeamActor("template",text(p,"draftId"),null):new TeamActor("employee",text(p,"employeeId"),text(p,"teamId"));
        return execute(uid,actor,required(input,"requestKey"),kind,body);
    }
    private ObjectNode beginAction(ObjectNode s,String job,ObjectNode p,ObjectNode input) {
        String key=required(input,"requestKey"),kind=required(input,"kind");JsonNode args=input.path("input");
        String hash=hash(kind+"\n"+canonical(args));
        Map<String,Object> prior=db.action(job,key);
        if(prior!=null) {
            if(!hash.equals(prior.get("request_hash")))throw new IllegalArgumentException("IDEMPOTENCY_CONFLICT: 动作内容不同");
            ObjectNode result=node("id",prior.get("id").toString(),"state",prior.get("state").toString());
            result.set("result",parse(prior.get("result")));return result;
        }
        if(p.has("runId")) {
            ObjectNode run=get(s,"runs",text(p,"runId"));ObjectNode task=get(s,"tasks",text(p,"taskId"));
            if((text(p,"kind").equals("turn")&&!TaskFlow.current(task,p))||!TaskFlow.blockingDecision(s,task).isBlank())return node("state","paused");
            if(run.path("manualPaused").asBoolean()||(text(task,"state").equals("blocked")||text(task,"state").equals("cancelled")||(text(task,"state").equals("completed")&&!text(p,"kind").equals("integration"))))return node("state","paused");
            int max=run.path("limits").path("maxRounds").asInt(25);
            long seconds=java.time.Duration.between(java.time.Instant.parse(text(run,"createdAt")),java.time.Instant.now()).toSeconds();
            boolean elapsed=seconds>=run.path("limits").path("maxSeconds").asInt(900);
            if(kind.equals("model")&&(run.path("calls").asInt()>=max||elapsed)) {
                task.put("state","blocked").put("reason","运行调用上限已达");
                run.put("state","waiting");alert(s,text(run,"teamId"),"运行达到配置上限，保留成果，等待你的下一步决定。",text(run,"id"));
                return node("state","budget_exceeded");
            }
            if(kind.equals("model"))run.put("calls",run.path("calls").asInt()+1);
            if(!text(task,"state").equals("completed"))task.put("state","running");
        }
        String id=id();db.startAction(id,job,key,hash,kind,args.toString());return node("id",id,"state","dispatched");
    }
    private ObjectNode actionResult(ObjectNode s,String job,ObjectNode p,ObjectNode input) {
        Map<String,Object> action=db.action(job,required(input,"requestKey"));
        if(action==null)throw new IllegalArgumentException("NOT_FOUND: 缺少动作意图");
        String state=required(input,"state");
        if(!Set.of("succeeded","failed","unknown").contains(state))throw new IllegalArgumentException("INVALID_STATE: 无效动作结果");
        if(!"dispatched".equals(action.get("state")))return node("state",action.get("state").toString());
        ObjectNode result=input.has("result")?(ObjectNode)input.get("result").deepCopy():node();
        db.endAction(action.get("id").toString(),state,result.toString());
        if(p.has("taskId")) {
            ObjectNode task=get(s,"tasks",text(p,"taskId"));ObjectNode a=node("id",action.get("id").toString(),"kind",action.get("kind").toString(),"state",state,"at",now());
            a.set("result",result);list(task,"executedActions").add(a);
            if(state.equals("unknown")) {task.put("state","needs_reconciliation");alert(s,text(task,"teamId"),"工具结果未知，已停止自动重试，请核查真实结果。",text(task,"id"));}
        }
        return node("state",state);
    }
    private ObjectNode finish(ObjectNode s,String id,ObjectNode p,ObjectNode input,long uid) {
        String state=required(input,"state");
        for(Map<String,Object> action:db.actions(id))if(Set.of("dispatched","unknown").contains(Objects.toString(action.get("state"),"")))state="needs_reconciliation";
        if(!Set.of("done","failed","paused","stopped","needs_reconciliation").contains(state))throw new IllegalArgumentException("INVALID_STATE: 无效结束状态");
        db.finish(id,text(input,"workerId"),input.path("fence").asLong(),state,input.path("result").toString());
        if(text(p,"kind").equals("template")) {
            ObjectNode d=get(s,"drafts",text(p,"draftId"));d.put("busy",false);
            if(!state.equals("done"))d.put("error",input.path("result").path("error").asText("生成未完成"));
            return node("state",state);
        }
        ObjectNode task=get(s,"tasks",text(p,"taskId")),run=get(s,"runs",text(p,"runId"));
        boolean current=!text(p,"kind").equals("turn")||TaskFlow.current(task,p);
        if(current&&p.has("deliveryId"))get(s,"deliveries",text(p,"deliveryId")).put("state",text(task,"state").equals("blocked")?"waiting_decision":state.equals("done")?"responded":state);
        if(current&&!Set.of("completed","cancelled","blocked","needs_reconciliation").contains(text(task,"state")))
            task.put("state",state.equals("done")?"awaiting_followup":state);
        if(state.equals("failed")||state.equals("needs_reconciliation"))
            alert(s,text(task,"teamId"),"执行未完成："+input.path("result").path("error").asText(state),text(task,"id"));
        String runState=text(run,"state");
        if(Set.of("pause_requested","stop_requested").contains(runState)&&db.running(uid,text(run,"id"))==0)
            run.put("state",runState.equals("pause_requested")?"paused":"stopped");
        if(state.equals("needs_reconciliation"))run.put("state","needs_reconciliation");
        return node("state",state);
    }
    public ObjectNode readExecution(long uid,String id) {
        Map<String,Object> job=db.job(id);
        if(job==null||((Number)job.get("owner_user_id")).longValue()!=uid)throw new IllegalArgumentException("SCOPE_FORBIDDEN: 无权读取执行记录");
        ObjectNode result=node("id",id,"state",Objects.toString(job.get("state"),""),"sandboxId",Objects.toString(job.get("sandbox_id"),""));
        result.set("actions",json.valueToTree(db.actions(id)));result.set("result",parse(job.get("result")));return result;
    }
    private ObjectNode reconcile(long uid,ObjectNode s,TeamActor actor,ObjectNode p) {
        human(actor);String id=required(p,"executionId");Map<String,Object> job=db.job(id);
        if(job==null||((Number)job.get("owner_user_id")).longValue()!=uid)throw new IllegalArgumentException("SCOPE_FORBIDDEN: 无权处理执行记录");
        if(!Set.of("needs_reconciliation","failed").contains(Objects.toString(job.get("state"),"")))throw new IllegalArgumentException("INVALID_STATE: 当前执行无需此操作");
        if(!p.path("executionStopped").asBoolean())throw new IllegalArgumentException("CLARIFICATION_REQUIRED: 需要先确认旧执行已停止");
        String resolution=required(p,"resolution"),evidence=required(p,"evidence");
        if(!Set.of("succeeded","failed").contains(resolution))throw new IllegalArgumentException("INVALID_INPUT: 请填写实际核实结果");
        ObjectNode payload=parse(job.get("payload"));ObjectNode task=get(s,"tasks",required(payload,"taskId"));
        ObjectNode record=node("executionId",id,"resolution",resolution,"evidence",evidence,"actorId",actor.id(),"recordedAt",now()).put("executionStopped",true);
        list(task,"reconciliationRecords").add(record);
        for(JsonNode action:list(task,"executedActions"))if(text(action,"state").equals("unknown"))((ObjectNode)action).set("manualResolution",record.deepCopy());
        for(Map<String,Object> action:db.actions(id))if(Set.of("dispatched","unknown").contains(Objects.toString(action.get("state"),""))) {
            ObjectNode result=parse(action.get("result"));result.set("manualResolution",record.deepCopy());
            db.endAction(action.get("id").toString(),"reconciled",result.toString());
        }
        task.put("state","paused").put("reason","核实结果已记录，等待明确恢复");
        for(JsonNode m:map(s,"messages"))if(text(m,"subjectId").equals(text(task,"id")))((ObjectNode)m).put("status","responded");
        if(text(payload,"kind").equals("integration")) {
            ObjectNode integration=get(s,"integrations",required(payload,"integrationId"));
            if(text(integration,"state").equals("queued"))
                integration.put("state","reconciled").set("reconciliation",record.deepCopy());
        }
        db.resolveJob(id);
        ObjectNode run=get(s,"runs",text(task,"runId"));
        if(db.unreconciledRun(uid,text(run,"id"))==0&&Set.of("active","needs_reconciliation").contains(text(run,"state")))
            run.put("state","paused");
        return node("id",id,"state","reconciled");
    }
    private ObjectNode lateResult(String id,ObjectNode p) {
        Map<String,Object> job=db.job(id);if(job==null)throw new IllegalArgumentException("NOT_FOUND: 执行不存在");
        long uid=((Number)job.get("owner_user_id")).longValue();ObjectNode s=locked(uid);
        ObjectNode payload=parse(job.get("payload"));
        if(payload.has("taskId"))list(get(s,"tasks",text(payload,"taskId")),"lateReports").add(
            node("executionId",id,"workerId",text(p,"workerId"),"requestKey",text(p,"requestKey"),"receivedAt",now())
                .put("fence",p.path("fence").asLong()).set("result",p.path("result").deepCopy()));
        persist(uid,s,"worker.late-result",node("jobId",id,"state","unverified-evidence"),text(payload,"teamId"));
        return node("state","recorded-not-applied");
    }
    public void authorizeObject(long uid,String key) {
        ObjectNode s=read(uid);
        for(JsonNode v:map(s,"codeVersions"))if(text(v,"bundleKey").equals(key))return;
        for(JsonNode v:map(s,"projects"))if(text(v,"baselineBundle").equals(key))return;
        throw new IllegalArgumentException("SCOPE_FORBIDDEN: 无权读取此版本归档");
    }
    private ObjectNode parse(Object value) {
        try {return value==null?json.createObjectNode():(ObjectNode)json.readTree(value.toString());}
        catch(Exception e){throw new IllegalStateException("Invalid stored team document",e);}
    }
    private String hash(String text) {
        try{return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
        catch(Exception e){throw new IllegalStateException(e);}
    }
    private JsonNode canonical(JsonNode input) {
        if(input.isObject()) {
            ObjectNode sorted=json.createObjectNode();TreeMap<String,JsonNode> fields=new TreeMap<>();
            input.fields().forEachRemaining(e->fields.put(e.getKey(),e.getValue()));
            fields.forEach((key,value)->sorted.set(key,canonical(value)));return sorted;
        }
        if(input.isArray()){ArrayNode items=json.createArrayNode();for(JsonNode item:input)items.add(canonical(item));return items;}
        return input;
    }
}
