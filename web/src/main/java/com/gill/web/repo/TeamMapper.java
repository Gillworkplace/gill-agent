package com.gill.web.repo;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.gill.web.entity.TeamWorkspaceRow;
import org.apache.ibatis.annotations.*;
import java.util.*;

/** SQL boundary; all multi-table, atomic and JSONB operations live in mapper XML. */
@Mapper
public interface TeamMapper extends BaseMapper<TeamWorkspaceRow> {
    void ensureWorkspace(@Param("uid") long uid);
    Map<String,Object> lockWorkspace(@Param("uid") long uid);
    void saveWorkspace(@Param("uid") long uid,@Param("document") String document);
    Map<String,Object> request(@Param("uid") long uid,@Param("key") String key);
    void saveRequest(@Param("uid") long uid,@Param("key") String key,@Param("hash") String hash,@Param("result") String result);
    void event(@Param("uid") long uid,@Param("team") String team,@Param("kind") String kind,@Param("payload") String payload);
    List<Map<String,Object>> events(@Param("uid") long uid,@Param("after") long after);
    void enqueue(@Param("id") String id,@Param("uid") long uid,@Param("team") String team,@Param("payload") String payload);
    Map<String,Object> claim(@Param("worker") String worker,@Param("mode") String mode,
                            @Param("owner") long owner,@Param("project") String project,@Param("runner") String runner,
                            @Param("browse") boolean browse);
    Map<String,Object> job(@Param("id") String id);
    int renew(@Param("id") String id,@Param("worker") String worker,@Param("fence") long fence);
    int finish(@Param("id") String id,@Param("worker") String worker,@Param("fence") long fence,@Param("state") String state,@Param("result") String result);
    void checkpoint(@Param("id") String id,@Param("checkpoint") String checkpoint);
    void sandbox(@Param("id") String id,@Param("sandbox") String sandbox);
    List<Map<String,Object>> actions(@Param("job") String job);
    Map<String,Object> action(@Param("job") String job,@Param("key") String key);
    void startAction(@Param("id") String id,@Param("job") String job,@Param("key") String key,@Param("hash") String hash,@Param("kind") String kind,@Param("input") String input);
    void endAction(@Param("id") String id,@Param("state") String state,@Param("result") String result);
    long running(@Param("uid") long uid,@Param("run") String run);
    void reconcileExpired();
    List<Map<String,Object>> jobStates(@Param("uid") long uid);
    long runningTask(@Param("uid") long uid,@Param("task") String task);
    long unresolvedTask(@Param("uid") long uid,@Param("task") String task);
    boolean resourceHasActiveJobs(@Param("uid") long uid,@Param("kind") String kind,@Param("id") String id);
    long unreconciledRun(@Param("uid") long uid,@Param("run") String run);
    void resolveJob(@Param("id") String id);
    void resumeTask(@Param("uid") long uid,@Param("task") String task,@Param("generation") int generation);
    long scheduledTask(@Param("uid") long uid,@Param("task") String task,@Param("generation") int generation);
}
