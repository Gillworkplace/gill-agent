'use strict';

// Local decision, delivery and digest demonstrations; no live execution or external checks.
function initWorkbenchInsights() {
  if(state.workbenchInsightsInitialized)return;
  state.workbenchInsightsInitialized=true;
  workbenchSeedArtifacts();
  const biz=team('biz'),decision=biz?.messages.find(m=>m.id==='b5');
  if(decision)decision.workbenchDecision={
    question:'本次跟进优先考虑近期成交，还是长期合作潜力？',
    decisionPoint:'请明确这次排序采用哪个侧重点。不会修改团队长期流程。',
    attempts:['江禾已分开整理近期机会与长期潜力，未替用户合并为一个排序。','顾言比较两种方案后，仍缺业务侧重点，沿汇报路径 @我。'],
    recommendation:'若本次目标是本周可推进的成果，示例建议 A；长期机会保留观察。',
    options:[
      {id:'near',label:'A · 优先近期成交',decision:'本次优先近期成交；长期潜力单列观察项。',cost:'可能推迟投入短期不易成交、但长期价值较高的机会。',next:'按近期可推进程度继续整理跟进建议，长期机会单列观察；尚未实际执行。'},
      {id:'long',label:'B · 优先长期潜力',decision:'本次优先长期合作潜力；近期成交不作为唯一排序依据。',cost:'本周可立即推进的机会可能排到后面，短期回报存在不确定性。',next:'按长期匹配度继续整理建议，注明短期机会的取舍；尚未实际执行。'},
    ],
    impact:'影响本次商机排序与最终建议，不直接修改模板、员工或团队流程。',
    waiting:'顾言与江禾等待这次排序取舍；不据此推断全团队均已停止。',
    evidence:[{id:'biz-report',version:2},{id:'biz-review',version:2}],
  };
  for(const t of state.teams)t.workbenchDigest=workbenchInitialDigest(t);
}
function workbenchSeedArtifacts() {
  const baseTitles={'biz-report':'商机分析简报','biz-review':'简报核查记录','dev-plan':'搜索体验方案'};
  const definitions={
    'biz-report':[
      {number:1,content:'商机分析简报 v1 · 合成历史\n近期成交与长期潜力尚未分开。\n转化率分母口径不一致，已在示例核查中提出。',checkStatus:'历史问题未解决',exampleChecks:['合成核查记录发现分母口径不一致。'],unchecked:['真实数据未核查。','优先级未决定。'],remainingIssues:['分母口径待修正。'],change:'初稿存在口径问题；不作为新版通过依据。'},
      {number:2,content:artifactData['biz-report']?.content,checkStatus:'示例口径已复核；取舍待决定',exampleChecks:['示例记录按统一口径重新核对 8 项数据。'],unchecked:['没有真实客户数据核验。','优先级取舍仍待用户决定。'],remainingIssues:['最终排序与跟进建议尚未完成。'],change:'分开近期机会与长期潜力，修正示例分母口径；仅记录模拟复核。'},
    ],
    'biz-review':[
      {number:1,content:'历史核查记录 · 检查对象：简报 v1\n发现分母口径不一致，要求负责员工修正。\n未形成通过结论。',checkStatus:'发现问题 · 历史示例',exampleChecks:['指出简报 v1 的口径问题。'],unchecked:['尚未检查修正后的版本。'],remainingIssues:['等待修正和新版本复核。'],subject:{id:'biz-report',version:1},change:'保留原始失败记录，不被后续复核覆盖。'},
      {number:2,content:artifactData['biz-review']?.content,checkStatus:'简报 v2 示例复核已记录',exampleChecks:['示例记录明确检查简报 v2，原口径问题已复核。'],unchecked:['没有真实数据检查或外部操作。','方案优先级不由核查结果自动决定。'],remainingIssues:['优先级仍需用户取舍。'],subject:{id:'biz-report',version:2},change:'重新检查明确的 v2；旧版结论不自动继承。'},
    ],
    'dev-plan':[
      {number:1,content:artifactData['dev-plan']?.content,checkStatus:'方案文档；实现尚未验证',exampleChecks:['合成方案列出搜索词保留、空结果与键盘访问要点。'],unchecked:['尚无真实代码或构建结果。','实际交互测试与浏览器核查均未执行。'],remainingIssues:['方案落地效果与关键路径仍未知。'],change:'当前只有方案说明，不是实现、测试或正式交付证据。'},
    ],
  };
  for(const [id,versions]of Object.entries(definitions)) {
    const a=artifactData[id];if(!a)continue;
    a.baseTitle=baseTitles[id];
    a.versions=versions.map(v=>Object.freeze({...v,title:`${a.baseTitle} · v${v.number}`,content:v.content||'',actualChecks:[],limitations:['全部为本地合成记录，没有真实模型、工具或外部核查。'],observedAt:'合成示例快照'}));
    const latest=a.versions.at(-1);a.currentVersion=latest.number;a.version=latest.number;a.current=true;
    a.checkStatus=latest.checkStatus;a.actualChecks=latest.actualChecks;a.unchecked=latest.unchecked;a.remainingIssues=latest.remainingIssues;a.limitations=latest.limitations;
  }
}
function workbenchInitialDigest(t) {
  const base={goal:t.goal,observedAt:'10:03 · 合成快照',viewedAt:null,certainty:'recorded',source:'本地演示记录',decisionMessageId:null};
  if(!t.members.length)return {...base,observedAt:'尚无执行快照',certainty:'unknown',state:'empty',current:'团队尚无实际员工。',blocker:'先从模板创建本团队员工。',next:'创建员工后再安排目标；没有工作已执行的依据。'};
  if(t.id==='biz')return {...base,state:'waiting',current:'示例口径复核已记录，最终建议尚未形成。',blocker:'本次排序侧重点等待用户明确。',next:'在群聊回复取舍，再继续整理建议。',decisionMessageId:'b5'};
  if(t.id==='dev')return {...base,state:'working',current:'本地记录：正在改进交互，尚无真实实现证据。',blocker:'实际代码、构建与交互测试均未验证。',next:'继续整理改进结果，取得真实验证依据后再判断完成。'};
  if(t.id==='ops')return {...base,state:'idle',current:'本地记录：空闲，尚无进行中的目标。',blocker:'暂无已知阻塞。',next:'在群聊交给团队一个目标。'};
  return {...base,observedAt:'尚无执行快照',certainty:'unknown',state:'unknown',current:'尚无可核对的工作反馈。',blocker:'当前执行状态未知。',next:'明确目标与任务安排，等待实际结果。'};
}
function workbenchTeamStatus(t) {
  if(!t.members.length)return 'empty';
  if(t.status==='paused')return 'paused';
  const d=t.workbenchDigest;
  if(!d||d.goal!==t.goal||d.certainty==='unknown')return 'unknown';
  if(d.certainty==='stale')return 'stale';
  return d.state||'unknown';
}
function effectiveWorkbenchStatus(t) { return workbenchTeamStatus(t); }
function workbenchStatusLabel(t) {
  const status=effectiveWorkbenchStatus(t),id=t.workbenchDigest?.decisionMessageId;
  const decision=id?messageFrom(t.id,id):t.messages.find(m=>m.kind==='decision'&&m.workbenchReply?.resolved===false);
  if(status==='waiting'&&decision?.workbenchReply?.resolved===false)return '待补充依据';
  return statuses[status]?.[1]||'状态未知';
}
function refreshWorkbenchDigest(t) {
  if(!t)return null;
  let d=t.workbenchDigest||workbenchInitialDigest(t);
  if(!t.members.length)d={...d,goal:t.goal,state:'empty',current:'团队尚无实际员工。',blocker:'需要先创建员工。',next:'目标可以保留，尚未开始实际工作。'};
  else if(d.state==='empty')d={...d,goal:t.goal,state:'unknown',certainty:'unknown',current:'员工已创建，尚无这个目标的实际执行反馈。',blocker:'任务安排与忙闲状态待核实。',next:'等待团队形成安排与真实结果；不推算已完成进度。'};
  else if(d.goal!==t.goal)d={...d,goal:t.goal,state:'unknown',certainty:'unknown',current:'新目标已记录，尚未核实任务安排与执行。',blocker:'没有这个目标的实际执行反馈。',next:'等待团队形成安排与真实结果；不推算已完成进度。',decisionMessageId:null,decisionSummary:null};
  else {
    const unresolved=t.messages.find(m=>m.kind==='decision'&&m.status==='needs-user');
    const answered=d.decisionMessageId?messageFrom(t.id,d.decisionMessageId):null;
    if(unresolved&&d.certainty!=='unknown')d={...d,state:'waiting',blocker:unresolved.workbenchReply?.resolved===false?'待补充依据，问题仍未解决；补证责任方待确认。':'等待群聊中明确的用户决定。',next:unresolved.workbenchReply?.resolved===false?'补充依据后回到原消息，再明确本次决定。':'查看 @消息，选择具体方案或说明决定。'};
    else if(answered?.workbenchReply?.resolved)d={...d,state:'ready',decisionSummary:'用户取舍已记录，待继续整理建议（本地模拟）；旧执行快照尚未重新核实。',blocker:'本次取舍已明确；尚无继续执行结果。',next:answered.workbenchReply.next};
  }
  d.viewedAt=new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'});
  if(t.status==='paused')d={...d,next:`团队仍暂停，没有自动恢复。${d.next}`.replace(/(团队仍暂停，没有自动恢复。)+/g,'团队仍暂停，没有自动恢复。')};
  t.workbenchDigest=d;return d;
}
function renderTeamDigest(t) {
  const d=t.workbenchDigest||workbenchInitialDigest(t),status=workbenchTeamStatus(t);
  const awaitingEvidence=d.decisionMessageId&&messageFrom(t.id,d.decisionMessageId)?.workbenchReply?.resolved===false;
  const labels={working:'合成工作记录',waiting:awaitingEvidence?'待补充依据':'等你取舍',idle:'空闲',paused:'仍为暂停',unknown:'状态未知',stale:'快照待核实',ready:'待继续整理',empty:'待创建员工'};
  const current=d.goal!==t.goal?'目标已变化，旧摘要未核实。':d.current;
  return `<div class="workbench-digest"><div class="digest-row digest-goal"><span class="digest-label">目标</span><span>${esc(t.goal||d.goal||'尚未确定目标')}</span></div><div class="digest-row digest-current"><span class="digest-label">当前</span><span>${esc(current)}</span></div><div class="digest-row digest-blocker"><span class="digest-label">阻塞</span><span>${esc(d.goal!==t.goal?'新目标尚无执行反馈。':d.blocker)}</span></div><div class="digest-row digest-next"><span class="digest-label">下一步</span><span>${esc(d.goal!==t.goal?'更新本地摘要，取得实际反馈。':d.next)}</span></div>${d.decisionSummary&&d.goal===t.goal?`<div class="digest-row digest-decision"><span class="digest-label">决定</span><span>${esc(d.decisionSummary)}</span></div>`:''}<div class="digest-meta"><span class="badge ${['unknown','stale'].includes(status)?'amber':'muted'}">${esc(status==='waiting'?workbenchStatusLabel(t):labels[status]||'状态未知')}</span><small>源更新时间：${esc(d.observedAt||'尚无执行快照')}</small><small>查看时间：${esc(d.viewedAt||'尚未重新查看')}</small></div><div class="digest-actions">${status==='waiting'&&d.decisionMessageId?button('定位待决定消息','workbench-reply','ghost small',`data-team="${esc(t.id)}" data-message="${esc(d.decisionMessageId)}"`):''}${button('更新本地摘要','workbench-refresh-digest','ghost small',`data-team="${esc(t.id)}"`)}</div></div>`;
}
function workbenchDecisionDefinition(m) {
  return m.workbenchDecision||{question:m.question||'这项工作需要你明确什么？',decisionPoint:'请明确可执行的处理意见。',attempts:(m.trace||[]).map(row=>`${row[0]}：${row[2]}`),recommendation:'尚无可核对的推荐依据。',options:[],impact:'仅针对这项问题；不自动改写团队长期规则。',waiting:'影响范围尚需具体核对，不推断全团队等待。',evidence:[]};
}
function renderDecisionCard(t,m) {
  const d=workbenchDecisionDefinition(m),pending=m.status==='needs-user',receipt=m.workbenchReply;
  return `<section class="decision-evidence-card"><span class="badge ${pending?'amber':'green'}">${pending?'需要你明确取舍':'决定已记录'}</span><h3 class="decision-question">${esc(d.question)}</h3><p>${esc(d.decisionPoint)}</p><details class="decision-context"><summary>已尝试与上级评估</summary><ul>${d.attempts.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></details><div class="decision-options">${d.options.map(o=>`<div class="decision-option"><b>${esc(o.label)}</b><p class="decision-cost">代价：${esc(o.cost)}</p>${pending?button('采用此选项','workbench-adopt-option','secondary small',`data-team="${esc(t.id)}" data-message="${esc(m.id)}" data-option="${esc(o.id)}"`):''}</div>`).join('')}</div><p class="muted small">示例推荐：${esc(d.recommendation)}</p><div class="decision-impact"><p><b>影响：</b>${esc(d.impact)}</p><p><b>${receipt?.resolved?'原等待范围':'等待'}：</b>${esc(d.waiting)}</p></div><div class="decision-actions">${d.evidence.filter(ref=>artifactData[ref.id]?.teamId===t.id).map(ref=>button(`${icon('file')} ${esc(artifactData[ref.id].title)}`,'workbench-artifact','ghost small',`data-team="${esc(t.id)}" data-id="${esc(ref.id)}" data-version="${ref.version}"`)).join('')}${button('完整依据','workbench-decision-details','ghost small',`data-team="${esc(t.id)}" data-message="${esc(m.id)}"`)}${pending?button('引用回复','workbench-reply','primary small',`data-team="${esc(t.id)}" data-message="${esc(m.id)}"`):''}</div>${receipt?`<div class="decision-receipt"><b>${receipt.resolved?'已记录决定':'回复已记录，问题未解决'}</b><p>${esc(receipt.recorded)}</p><p>影响：${esc(receipt.impact)}</p><p>下一步：${esc(receipt.next)}</p></div>`:''}<p class="demo-note">本地决策演示；阅读卡片或证据不会提交决定，采用具体选项就是本次明确回复。</p></section>`;
}
function workbenchVersion(a,number) { return number==null?a.versions?.find(v=>v.number===a.currentVersion):a.versions?.find(v=>v.number===Number(number)); }
function workbenchArtifactTitle(a,number) { return `${a.baseTitle||a.title} · v${number}`; }
function renderDeliveryCard(teamId,artifactId) {
  const a=artifactData[artifactId];if(!a||a.teamId!==teamId)return '<div class="delivery-card notice amber">未找到本团队对应的产物，未引用其他团队证据。</div>';
  const v=workbenchVersion(a);if(!v)return '';
  return `<section class="delivery-card"><div class="delivery-card-head"><span>${icon('file')} <b>${esc(a.title)}</b></span><span class="badge muted">当前 v${v.number}</span></div><p class="delivery-meta">${esc(v.checkStatus)}</p><div class="delivery-checks"><b>示例检查：</b>${esc(v.exampleChecks[0]||'尚无示例核查记录。')}</div><p class="delivery-limits"><b>未验证：</b>${esc(v.unchecked.join(' '))}</p><p class="delivery-limits"><b>剩余：</b>${esc(v.remainingIssues.join(' '))}</p><div class="decision-actions">${button('内容与依据','workbench-artifact','secondary small',`data-team="${esc(teamId)}" data-id="${esc(artifactId)}"`)}${a.versions.length>1?button('比较版本','workbench-compare-artifact','ghost small',`data-team="${esc(teamId)}" data-id="${esc(artifactId)}"`):''}</div><p class="demo-note">合成记录；真实执行检查 ${v.actualChecks.length} 项，不代表正式交付。</p></section>`;
}
function workbenchArtifactDrawer(d) {
  if(d.type==='workbench-decision-details')return workbenchDecisionDrawer(d);
  if(!['artifact','workbench-artifact','workbench-artifact-compare'].includes(d.type))return null;
  const a=artifactData[d.id];if(!a?.versions)return null;
  if(d.teamId&&d.teamId!==a.teamId)return {title:'产物不属于本团队',body:'没有混用其他团队的产物或证据。',foot:button('关闭','close')};
  const v=workbenchVersion(a,d.version);if(!v)return {title:'版本不存在',body:'没有用当前版本替代指定的旧版本。',foot:button('关闭','close')};
  const title=d.type==='workbench-artifact-compare'?`${a.baseTitle||a.title} · 版本比较`:workbenchArtifactTitle(a,v.number);
  const body=d.type==='workbench-artifact-compare'?workbenchVersionComparison(a):workbenchArtifactBody(a,v);
  return {kicker:`${esc(team(a.teamId)?.name||'所属团队')} · 合成交付依据`,title:esc(title),body:`<div class="delivery-version-tabs">${a.versions.map(item=>button(`v${item.number}${item.number===a.currentVersion?' · 当前':''}`,'workbench-artifact',`secondary small ${item.number===v.number?'active':''}`,`data-team="${esc(a.teamId)}" data-id="${esc(d.id)}" data-version="${item.number}"`)).join('')}${a.versions.length>1?button('版本比较','workbench-compare-artifact','ghost small',`data-team="${esc(a.teamId)}" data-id="${esc(d.id)}"`):''}</div>${body}<p class="demo-note">全部内容与核查记录为合成演示，没有执行真实模型、外部检查或 Git 操作。旧版结论不自动覆盖新版。</p>`,foot:button('关闭','close')};
}
function workbenchArtifactBody(a,v) {
  const subject=v.subject?`<p class="muted small">检查对象：${esc(artifactData[v.subject.id]?.baseTitle||v.subject.id)} · v${v.subject.version}</p>`:'';
  return `<section class="delivery-section"><span class="badge ${v.remainingIssues.length?'amber':'muted'}">v${v.number} · ${esc(v.checkStatus)}</span>${subject}<div class="artifact-preview"><pre>${esc(v.content)}</pre></div></section><section class="delivery-section"><h3>这一版本的依据与边界</h3><ul>${v.exampleChecks.map(s=>`<li>合成示例：${esc(s)}</li>`).join('')}<li>真实执行检查：${v.actualChecks.length} 项；未执行真实核查。</li>${v.unchecked.map(s=>`<li>未验证：${esc(s)}</li>`).join('')}${v.remainingIssues.map(s=>`<li>仍需处理：${esc(s)}</li>`).join('')}</ul><p class="muted small">${esc(v.change)}</p></section>`;
}
function workbenchVersionComparison(a) {
  const before=a.versions[0],after=a.versions.at(-1),oldLines=new Set(before.content.split('\n')),newLines=new Set(after.content.split('\n'));
  const diff=[...oldLines].filter(s=>!newLines.has(s)).map(s=>`− ${s}`).concat([...newLines].filter(s=>!oldLines.has(s)).map(s=>`+ ${s}`)).join('\n');
  return `<div class="delivery-compare"><section class="delivery-section"><h3>旧版 v${before.number}</h3><p>${esc(before.checkStatus)}</p><p class="muted small">${esc(before.remainingIssues.join(' '))}</p></section><section class="delivery-section"><h3>当前 v${after.number}</h3><p>${esc(after.checkStatus)}</p><p class="muted small">${esc(after.unchecked.join(' '))}</p></section></div><section class="delivery-section"><h3>合成文本变化</h3><div class="artifact-preview"><pre>${esc(diff||'没有文本差异。')}</pre></div><p class="muted small">这里只比较本地示例文本，不推导真实验证通过或实际代码变更。</p></section>`;
}
function workbenchDecisionDrawer(d) {
  const t=team(d.teamId),m=t?messageFrom(t.id,d.messageId):null;
  if(!t||!m||m.kind!=='decision')return {title:'没有找到本团队的决定事项',body:'没有引用其他团队上下文。',foot:button('关闭','close')};
  const def=workbenchDecisionDefinition(m);
  return {kicker:'明确取舍 · 不修改长期规则',title:esc(def.question),body:`<div class="delivery-section"><h3>团队已做过什么</h3><ul>${def.attempts.map(s=>`<li>${esc(s)}</li>`).join('')}</ul></div><div class="delivery-section"><h3>上报经过</h3><div class="timeline">${(m.trace||[]).map(([name,label,text])=>`<div class="timeline-item"><b>${esc(name)} · ${esc(label)}</b><p>${esc(text)}</p></div>`).join('')}</div></div><p>${esc(def.impact)}</p><p class="muted small">原等待范围：${esc(def.waiting)}</p>${m.workbenchReply?`<div class="decision-receipt"><h3>回复记录</h3><p>${esc(m.workbenchReply.summary)}</p></div>`:''}<p class="demo-note">打开本抽屉不会改变决定状态或清除 @计数。</p>`,foot:`${button('关闭','close')}${m.status==='needs-user'?button('回群聊回复','workbench-reply','primary',`data-team="${esc(t.id)}" data-message="${esc(m.id)}"`):''}`};
}
function recordWorkbenchReply(t,m,text,context={}) {
  if(!t||!m||m.kind!=='decision')return null;
  const def=workbenchDecisionDefinition(m),option=def.options.find(o=>o.id===context.optionId);
  const uncertain=/不确定|拿不准|不知道|待定|再看看|稍后|补充|补资料|补.*依据|先核实|需要.*资料|无法决定|不能决定|先等等|还没想好|不采用|不同意|暂不/.test(text);
  const explicit=/^(我决定|决定采用|采用方案|选择方案|本次优先|优先近期|优先长期|按[ABＡＢ]方案)/.test(text.trim());
  const resolved=Boolean(option)||(!uncertain&&explicit);
  const impact=def.impact,next=resolved?(option?.next||'已记录明确处理意见，待团队继续整理；尚无执行结果。'):'继续补充依据或等待用户明确取舍，问题未解决。';
  const receipt={resolved,kind:resolved?'decision':'clarification',recorded:text,impact,next,status:resolved?'responded':'needs-user',source:option?'用户点击具体选项':'自由回复的本地保守识别',summary:`${resolved?'已记录决定':'回复已保留，取舍仍未明确'}：${text} 影响：${impact} 下一步：${t.status==='paused'?'团队仍暂停，没有自动恢复。':''}${next}`};
  m.response=text;m.status=receipt.status;m.workbenchReply=receipt;
  if(t.workbenchDigest)t.workbenchDigest.decisionMessageId=m.id;
  refreshWorkbenchDigest(t);return receipt;
}
function handleWorkbenchAction(el) {
  const d=el.dataset,actions={
    'workbench-artifact':()=>openDrawer('workbench-artifact',{id:d.id,teamId:d.team,version:d.version?Number(d.version):undefined}),
    'workbench-compare-artifact':()=>openDrawer('workbench-artifact-compare',{id:d.id,teamId:d.team}),
    'workbench-decision-details':()=>openDrawer('workbench-decision-details',{teamId:d.team,messageId:d.message}),
    'workbench-reply':()=>replyTo(d.team,d.message),
    'workbench-refresh-digest':()=>{const t=team(d.team);if(t){refreshWorkbenchDigest(t);render();toast('已重新查看本地记录，不代表真实执行状态已核实。');}},
    'workbench-adopt-option':()=>workbenchAdoptOption(d.team,d.message,d.option),
  };
  if(!actions[d.action])return false;actions[d.action]();return true;
}
function workbenchAdoptOption(teamId,messageId,optionId) {
  const t=team(teamId),m=t?messageFrom(t.id,messageId):null,option=m?workbenchDecisionDefinition(m).options.find(o=>o.id===optionId):null;
  if(!t||!m||!option)return toast('没有找到本团队的具体选项。');
  if(m.status!=='needs-user')return toast('这个决定已有记录，没有重复应用。');
  const text=`我决定：${option.decision}`,receipt=recordWorkbenchReply(t,m,text,{optionId});
  t.messages.push({id:`workbench-user-${Date.now()}`,sender:'user',time:'刚刚',text});
  t.messages.push({id:`workbench-receipt-${Date.now()}`,sender:m.sender,time:'刚刚',text:`【本地模拟反馈】${receipt.summary}`});
  closeOverlay();render();scrollChat();toast('具体决定已记录；没有把记录决定当作已继续执行。');
}
function handleWorkbenchForm() { return false; }
