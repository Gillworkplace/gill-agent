package com.gill.web.entity;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

/** Persistence shape of one user's bounded team workspace aggregate. */
@TableName("team_workspaces")
public class TeamWorkspaceRow {
    @TableId
    public Long ownerUserId;
    public Long revision;
    public String document;
    public java.time.OffsetDateTime updatedAt;
}
