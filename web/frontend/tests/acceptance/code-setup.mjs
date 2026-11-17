import fs from 'node:fs';
import {fixture} from './harness.mjs';
if(process.env.ACCEPTANCE_URL!=='http://127.0.0.1:8080')throw Error('Set ACCEPTANCE_URL explicitly to the authorized main test instance; cloud sweeper must see this database');
const a=await fixture({limits:{maxRounds:6,maxSeconds:900}});
const checks=`set -eu; test -f README; for file in *.sh; do test ! -e "$file" || bash -n "$file"; done; if test -f percentage.sh; then test "$(bash percentage.sh 100 120)" = 20; test "$(bash percentage.sh 100 80)" = -20; if bash percentage.sh 0 120 >/dev/null 2>&1; then exit 1; fi; fi; if test -f normalize.sh; then test "$(bash normalize.sh '  gill  ')" = GILL; test "$(bash normalize.sh '   ')" = ''; fi`;
const project=(await a.ok('project.save',{teamId:a.team,name:'公开已有基线并行验收',repositoryUrl:'https://github.com/octocat/Hello-World.git',targetBranch:'master',checkCommand:checks,protectedBranches:[]})).id;
const prompt='你依据明确目标处理本项目的独立工作。可自主使用文件、shell和Git工具；基线已配置，在/workspace操作。只根据工具真实回执声明执行结果。尽量合并独立操作，最多6轮模型调用；完成真实验证后save_version归档，record_artifact写明实际commit、验证及未验证范围，complete_task结束。新产物省略id，由服务端分配。不要推送远端或请求集成，版本集成由后续独立验收执行。不要修改已有README。';
for(const id of a.members)await a.ok('employee.update',{id,expectedRevision:1,prompt});
const tasks=[];
for(const [employeeId,goal]of [
 [a.members[0],'需求A：在已有基线新增percentage.sh，使 bash percentage.sh 100 120 输出20、100 80输出-20；基数0必须非零退出。用shell真实验证这三个情况，再保存代码版本、记录产物并结束。不需要其他员工协作，不修改README，不改其他需求文件。'],
 [a.members[1],"需求B：在同一已有基线新增normalize.sh，使 bash normalize.sh '  gill  ' 输出GILL，纯空白参数输出空字符串并正常退出。使用shell真实验证两种输入，再保存代码版本、记录产物并结束。不修改README或percentage.sh。"]
])tasks.push((await a.ok('task.assign',{employeeId,goal,projectId:project})).id);
fs.writeFileSync('/tmp/gill-acceptance-code.json',JSON.stringify({username:a.username,password:a.password,token:a.token,teamId:a.team,projectId:project,members:a.members,tasks,startedAt:new Date().toISOString(),expectedRemoteBaseline:'7fd1a60b01f91b314f59955a4e4d4e80d8edf11d'}),{mode:0o600});
console.log('Two real model coding tasks queued in a dedicated new main-database account; no user team was modified');
