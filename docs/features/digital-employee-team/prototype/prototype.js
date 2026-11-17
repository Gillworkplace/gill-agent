'use strict';

// 隔离交互原型：全部内容为本地合成数据；不调用模型、后台或外部业务系统。
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/><circle cx="9" cy="7" r="4"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v2"/>',
  network: '<rect x="8" y="2" width="8" height="6" rx="1.5"/><rect x="2" y="16" width="7" height="6" rx="1.5"/><rect x="15" y="16" width="7" height="6" rx="1.5"/><path d="M12 8v4m-7 4v-4h14v4"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  inbox: '<path d="M4 4h16l2 11v5H2v-5L4 4Z"/><path d="M2 14h6l2 3h4l2-3h6"/>',
  tools: '<path d="m14.7 6.3 3 3m-5.4 4.4-7 7-3-3 7-7A6 6 0 0 1 17 3l-3 3 4 4 3-3a6 6 0 0 1-8.7 6.7Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="m12 5-7 7 7 7m-7-7h14"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7-1v4m-2-2h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5Z"/><path d="M14 2v6h5M8 13h8m-8 4h6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m7 4 14 8-14 8V4Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-1 1 5 5"/>',
  chat: '<path d="M21 11a9 9 0 0 1-9 9H3l2-5a9 9 0 1 1 16-4Z"/><path d="M8 10h8m-8 4h5"/>',
  link: '<path d="m10 13 4-4m-5-3 2-2a5 5 0 0 1 7 7l-2 2m-1 5-2 2a5 5 0 0 1-7-7l2-2"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-8 4 4-20"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
};
const icon = (name, extra = '') => `<svg class="icon ${extra}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.grid}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button = (label, action, cls = 'secondary', extra = '') => `<button class="btn ${cls}" data-action="${action}" ${extra}>${label}</button>`;
const defaultFlow = '围绕目标自主分工、沟通并选择工作方法，不限定固定步骤。\n重要成果交叉核查，发现问题后修正并保留复核依据。\n拿不准的方案先交直属上级评估，逐级仍无法解决再在群聊 @我。\n知识库资料只读；员工模板可自迭代，保留版本与来源。新增员工或修改团队流程 Prompt，只向我提出建议。';
const skill = (id,name,description,content) => ({id,name,description,content});
function initialState() {
  const templates=[
    {id:'lead',name:'团队协调与评估',icon:'network',color:'blue',version:1,description:'澄清目标、协调协作，评估团队拿不准的方案。',prompt:'围绕团队目标自主协调工作，与成员核对事实和方案。职责用于分工，不限制处理其他问题。下级拿不准时先评估，仍无法解决再汇总依据与方案 @用户。员工模板可自迭代并保留来源；新增员工或修改团队流程仅提建议。',skills:[skill('clarify','目标澄清','补齐目标、资料与交付要求。','识别目标、已有事实、约束和期望结果。必要时提出具体问题；保留来源，不替用户作关键取舍。'),skill('coordinate','协作与评估','组织分工并评估不确定问题。','结合任务与反馈动态协调，记录依据与分工。拿不准时沿上下级继续上报。')]},
    {id:'analyse',name:'资料分析',icon:'search',color:'violet',version:1,description:'整理资料、分析事实，形成有依据的判断。',prompt:'根据目标整理和分析资料，注明事实来源，自主选择工具与方法。主动与团队交叉核查，遇到不确定方案提交直属上级。',skills:[skill('research','资料分析','提取事实、发现缺口并整理判断。','区分原始事实、推断与缺失信息。保留引用与版本，不把未经核查的结论当作已知事实。')]},
    {id:'verify',name:'独立核查',icon:'check',color:'orange',version:1,description:'核对成果、提出问题并复核修正结果。',prompt:'围绕当前目标检查具体成果及依据。发现问题后与负责员工协作修正，复核新版本并保留历史记录。拿不准则提交上级评估。',skills:[skill('review','交叉核查','检查具体产物及其依据。','明确检查对象和版本。记录问题、修正、复核与未验证范围；不以相互认可替代真实结果。')]},
    {id:'build',name:'实现与自动化',icon:'code',color:'green',version:1,description:'使用可用工具、脚本和代码完成工作。',prompt:'结合目标和环境选择方法，使用可用工具或编写辅助脚本完成工作，并保留结果。分工不限制能力；遇到拿不准的方案提交上级评估。',skills:[skill('execute','工具与自动化','组合工具、脚本或代码完成任务。','在实际环境中执行，保存产物和结果。区分成功、失败、未执行与结果未知；需要核查时主动协作。')]},
  ];
  const people=[
    ['dev-lead','林岚','研发协作团队负责人','blue','dev','lead','user','working'],
    ['dev-plan','程野','方案分析','violet','dev','analyse','dev-lead','working'],
    ['dev-build','许澄','实现与自动化','green','dev','build','dev-lead','working'],
    ['dev-review','周予','质量核查','orange','dev','verify','dev-lead','idle'],
    ['biz-lead','顾言','业务洞察团队负责人','blue','biz','lead','user','waiting'],
    ['biz-analyse','江禾','业务分析','violet','biz','analyse','biz-lead','working'],
    ['biz-review','禾宁','结果核查','orange','biz','verify','biz-lead','idle'],
    ['ops-lead','乔安','内容研究团队负责人','blue','ops','lead','user','idle'],
    ['ops-analyse','唐宁','资料研究','violet','ops','analyse','ops-lead','idle'],
  ].map(([id,name,role,color,teamId,templateId,parentId,status])=>{const tpl=templates.find(t=>t.id===templateId);return {id,name,role,color,teamId,templateId,parentId,status,templateVersion:tpl.version,prompt:tpl.prompt,skills:structuredClone(tpl.skills)};});
  const teams=[
    {id:'biz',name:'业务洞察团队',icon:'activity',color:'violet',description:'商机资料与跟进建议；覆盖资料分析、指标核查和优先级建议。',status:'waiting',goal:'形成本周商机跟进建议',done:2,total:4,flow:defaultFlow,flowVersion:2,members:['biz-lead','biz-analyse','biz-review'],tasks:[['梳理资料与关键事实','done'],['形成建议并交叉核查','done'],['明确优先级取舍','waiting'],['整理最终建议','pending']],messages:[
      {id:'b1',sender:'biz-analyse',time:'09:32',text:'我已整理 12 条示例商机，形成分析初稿。关键事实和缺失信息已经分开记录。'},
      {id:'b2',sender:'biz-review',time:'09:38',text:'初稿的转化率分母口径不一致，已提出核查问题。请修正后再复核。'},
      {id:'b3',sender:'biz-analyse',time:'09:44',text:'已按统一口径修正，提交简报 v2；旧版本和问题记录仍保留。',artifactId:'biz-report'},
      {id:'b4',sender:'biz-review',time:'09:49',text:'v2 的示例数据已经重新核查，原有问题已复核。优先级取舍还需要补充依据。',artifactId:'biz-review'},
      {id:'b5',sender:'biz-lead',time:'09:56',kind:'decision',mention:true,status:'needs-user',text:'@我 近期成交与长期潜力的优先级存在冲突。江禾已向我提交，我评估后仍缺少业务侧重点，需要你作取舍。',question:'这次跟进优先考虑近期成交，还是长期合作潜力？',trace:[['江禾','提交不确定问题','资料同时强调两种优先级，向直属上级提交评估。'],['顾言','评估后仍缺少依据','比较方案后，仍需用户明确业务侧重点。'],['我','等待回复','问题通过群聊 @我 提交；读过消息不代表已经决定。']]},
      {id:'b6',sender:'biz-lead',time:'10:03',kind:'proposal',mention:true,status:'needs-user',templateId:'verify',text:'@我 禾宁建议补充核查模板的 Skill：关键指标需逐项记录口径与资料来源。这是调整建议，尚未修改模板。',proposedSkill:skill('metric','指标口径核查','核对分母、来源和适用版本。','逐项核对关键指标的分子、分母、资料来源和适用版本。缺少依据时保留问题，修正后针对新版本复核。')},
    ]},
    {id:'dev',name:'研发协作团队',icon:'code',color:'blue',description:'数字员工工作台；负责搜索筛选、团队协作与交互体验模块。',status:'working',goal:'改进工作台的搜索体验',done:2,total:5,flow:defaultFlow,flowVersion:3,members:['dev-lead','dev-plan','dev-build','dev-review'],tasks:[['理解目标与现有体验','done'],['比较方案','done'],['完成交互改进','working'],['核查关键路径','pending'],['整理变更说明','pending']],messages:[
      {id:'d1',sender:'dev-lead',time:'09:40',text:'这次先围绕搜索体验安排工作。计划会根据实际反馈调整，不要求固定阶段。'},
      {id:'d2',sender:'dev-plan',time:'09:48',text:'已比较两种筛选方案，记录了选择依据与影响。',artifactId:'dev-plan'},
      {id:'d3',sender:'dev-review',time:'09:53',text:'我补充了空结果与键盘访问的核查要点，实际核查尚未执行。'},
      {id:'d4',sender:'dev-build',time:'10:02',text:'正在处理交互改进，同时整理可供核查的变更说明。'},
    ]},
    {id:'ops',name:'内容研究团队',icon:'file',color:'green',description:'内容研究与资料服务；负责专题研究、资料整理和内容成果。',status:'idle',goal:'暂无进行中的工作',done:0,total:0,flow:defaultFlow,flowVersion:1,members:['ops-lead','ops-analyse'],tasks:[],messages:[{id:'o1',sender:'ops-lead',time:'09:20',text:'团队已准备好。你可以直接在群里描述一个目标，我们会据此组织工作。'}]},
  ];
  return {templates,people,teams,activeTeamId:'biz',drawer:null,modal:null,mentionOnly:false,replyTo:null,generationToken:0,templateFilter:'',toastTimer:null};
}
let state=initialState();
state.templateChat=initialTemplateChat();
const person=id=>state.people.find(p=>p.id===id);
const team=id=>state.teams.find(t=>t.id===id);
const template=id=>state.templates.find(t=>t.id===id);
const mentions=t=>t.messages.filter(m=>m.mention&&m.status==='needs-user');
const avatar=id=>{const p=person(id);return `<span class="avatar ${p?.color||'blue'}">${esc(p?.name.slice(-1)||'我')}</span>`;};
const statuses={working:['green','工作中'],waiting:['amber','等我回复'],idle:['muted','空闲'],paused:['muted','已暂停 · 演示']};
const statusBadge=s=>`<span class="badge ${statuses[s]?.[0]||'muted'}">${statuses[s]?.[1]||esc(s)}</span>`;
const teamPeople=t=>t.members.map(person);
const teamStatusBadge=t=>t.members.length?statusBadge(t.status):'<span class="badge muted">待创建员工</span>';
function availability(t) {const ps=teamPeople(t);return {idle:ps.filter(p=>p.status==='idle').length,working:ps.filter(p=>p.status==='working').length,waiting:ps.filter(p=>p.status==='waiting').length};}
function route() {
  const [raw,id]=(location.hash.replace(/^#\/?/,'')||'overview').split('/');
  const page=raw==='employees'?'templates':['overview','templates','template','studio','teams','team','library','project','knowledge','knowledge-item','employee-knowledge'].includes(raw)?raw:'overview';
  if(page!==raw)history.replaceState(null,'',`#/${page}`);
  return {page,id};
}
function navigate(path) {state.drawer=null;state.modal=null;state.replyTo=null;document.body.classList.remove('nav-open','channels-open');if(location.hash===`#/${path}`)render();else location.hash=`#/${path}`;}
function render() {
  const r=route();if(r.page==='overview'&&team(r.id))state.activeTeamId=r.id;
  const active=['template','studio'].includes(r.page)?'templates':['team','library','project','employee-knowledge'].includes(r.page)?'teams':r.page==='knowledge-item'?'knowledge':r.page;
  const labels={overview:'工作台',templates:'数字员工模板',template:'数字员工模板',studio:'对话创建模板',teams:'团队',team:'团队',library:'团队项目库',project:'项目',knowledge:'知识库','knowledge-item':'知识详情','employee-knowledge':'员工知识'};
  const count=state.teams.reduce((sum,t)=>sum+mentions(t).length,0);
  document.body.classList.toggle('chat-mode',r.page==='overview');
  document.querySelector('#app').innerHTML=`<div class="shell"><aside class="sidebar"><a class="brand" href="#/overview"><span class="brand-mark">g</span><span>Gill<small>数字员工团队</small></span></a><div class="workspace-label">我的工作空间</div><nav class="nav" aria-label="主导航">${[['overview','chat','工作台'],['templates','users','数字员工模板'],['teams','network','团队'],['knowledge','file','知识库']].map(([page,i,name])=>`<a href="#/${page}" class="nav-item ${active===page?'active':''}">${icon(i)}<span>${name}</span>${page==='overview'&&count?`<span class="mention-count">@${count}</span>`:''}</a>`).join('')}</nav><div class="sidebar-bottom"><button class="user" data-action="guide"><span class="avatar blue">我</span><span>团队管理者<small>交互原型 v0.5</small></span>${icon('info')}</button></div></aside><button class="sidebar-scrim" data-action="nav-toggle" aria-label="关闭导航"></button><main class="main"><header class="topbar"><div class="breadcrumbs"><button class="icon-btn mobile-menu" data-action="nav-toggle" aria-label="打开导航">${icon('menu')}</button><b>${labels[r.page]}</b></div><div class="top-actions"><span class="prototype-tag">交互原型 · 演示数据</span><button class="icon-btn" data-action="guide" aria-label="演示说明">${icon('info')}</button></div></header><div class="content ${r.page==='overview'?'chat-content':r.page==='studio'?'studio-content':''}">${renderPage(r)}</div></main></div>`;
  renderOverlay();
  if(r.page==='studio')scrollTemplateChat();
}
function renderPage(r) {
  if(r.page==='templates')return renderTemplates();
  if(r.page==='template')return renderTemplate(r.id);
  if(r.page==='studio')return renderTemplateStudio();
  if(r.page==='teams')return renderTeams();
  if(r.page==='team')return renderTeam(r.id);
  if(r.page==='library')return renderLibrary(r.id);
  if(r.page==='project')return renderProject(r.id);
  if(r.page==='knowledge')return renderKnowledgeLibrary();
  if(r.page==='knowledge-item')return renderKnowledgeItem(r.id);
  if(r.page==='employee-knowledge')return renderEmployeeKnowledge(r.id);
  return renderOverview();
}
function pageHead(title,description,actions='') {return `<div class="page-head"><div><h1>${title}</h1><p class="subtitle">${description}</p></div><div class="page-actions">${actions}</div></div>`;}
function channelCard(t) {
  const a=availability(t);const count=mentions(t).length;
  return `<a class="channel ${state.activeTeamId===t.id?'active':''}" href="#/overview/${t.id}"><span class="channel-icon ${t.color}">${icon(t.icon)}</span><span class="channel-main"><span class="channel-name"><b>${esc(t.name)}</b>${count?`<span class="mention-count">@我 ${count}</span>`:''}</span><span class="channel-bottom"><span class="channel-state"><i class="dot ${t.status==='working'?'green':t.status==='waiting'?'amber':''}"></i>${t.members.length?statuses[t.status]?.[1]||'空闲':'待创建员工'}</span><span>${t.members.length?`${a.idle}/${t.members.length} 空闲`:'尚无成员'}</span></span>${t.total?`<span class="mini-progress"><i style="width:${Math.round(t.done/t.total*100)}%"></i></span><small class="channel-progress">完成 ${t.done}/${t.total} 项 · ${esc(t.goal)}</small>`:'<small class="channel-progress">暂无进行中的工作</small>'}</span></a>`;
}
function renderTeamPanel(t) {
  return `<aside class="team-channels" aria-label="团队状态"><div class="channel-heading"><div><h2>团队状态</h2><span class="muted small">${state.teams.length} 个团队 · 点击切换群聊</span></div><button class="icon-btn" data-action="new-team" aria-label="新建团队">${icon('plus')}</button></div><div class="channel-list">${state.teams.map(channelCard).join('')}</div><div class="channel-footer"><a class="btn secondary small" href="#/library/${t.id}">${icon('file')} 项目库 · ${state.projects.filter(p=>p.teamId===t.id).length} 个项目</a><button class="btn secondary small" data-action="team-summary" data-id="${t.id}">查看当前团队详情 ${icon('chevron')}</button></div></aside>`;
}
function renderOverview() {
  const t=team(state.activeTeamId)||state.teams[0];if(!t)return '<div class="empty"><h2>先创建一个团队</h2><a class="btn primary" href="#/teams">创建团队</a></div>';
  const count=mentions(t).length;const feed=state.mentionOnly?t.messages.filter(m=>m.mention):t.messages;
  return `<div class="chat-workspace"><section class="chat-room"><header class="chat-header"><div class="chat-heading"><span class="channel-icon ${t.color}">${icon(t.icon)}</span><span><h2>${esc(t.name)}</h2><small>${t.members.length} 位专属员工 · ${esc(t.description)}</small></span></div><div class="chat-actions"><button class="btn secondary small team-panel-toggle" data-action="channels-toggle" aria-label="打开右侧团队状态">${icon('users')} 团队</button></div></header><div class="mention-toolbar"><button class="mention-filter ${state.mentionOnly?'active':''}" data-action="toggle-mentions">@我 ${count?`<span>${count}</span>`:''}</button><span>${count?'有需要你回复的消息，点击卡片查看或直接回复。':'群聊里没有等待你回复的 @消息。'}</span>${state.mentionOnly?button('显示全部消息','show-all','ghost small'):''}</div><div class="chat-feed" id="chat-feed"><div class="chat-day">今天 · 合成演示</div>${feed.map(m=>renderMessage(t,m)).join('')||'<div class="empty">还没有 @你的消息。</div>'}</div><form class="chat-composer" data-form="chat" data-team="${t.id}">${state.replyTo?.teamId===t.id?`<div class="reply-preview">回复 ${esc(person(t.messages.find(m=>m.id===state.replyTo.messageId)?.sender)?.name||'团队')} 的 @消息 <button class="icon-btn" type="button" data-action="cancel-reply" aria-label="取消引用">${icon('close')}</button></div>`:''}<textarea id="chat-input" aria-label="团队群聊消息" placeholder="直接给团队一个目标、补充资料，或回复 @你的问题…"></textarea><div class="composer-foot"><span class="composer-hint">消息和决定都留在这个群里</span><button class="btn primary" type="submit">发送 ${icon('arrow')}</button></div></form></section><button class="channel-backdrop" data-action="channels-toggle" aria-label="关闭右侧团队状态"></button>${renderTeamPanel(t)}</div>`;
}
function renderMessage(t,m) {
  const p=person(m.sender),self=m.sender==='user';const needs=m.mention&&m.status==='needs-user';
  let body=`<p>${esc(m.text).replace(/@我/g,'<span class="mention-label">@我</span>')}</p>`;
  if(m.kind==='decision')body+=`<div class="chat-decision"><b>${esc(m.question)}</b><p class="muted small">${needs?'团队已经过上级评估，仍需要你的取舍。':m.status==='followup'?'已要求上级补充依据，问题仍未解决。':'你已回复，决定保留在群聊中。'}</p><div class="decision-actions">${button('查看上报经过','trace','secondary small',`data-team="${t.id}" data-message="${m.id}"`)}${needs?button('回复决定','reply-message','primary small',`data-team="${t.id}" data-message="${m.id}"`):'<span class="badge muted">已回应</span>'}</div></div>`;
  if(m.kind==='proposal')body+=`<div class="chat-decision"><span class="badge blue">模板 Skill 调整建议</span><p style="margin-top:8px">${esc(m.proposedSkill.name)}：${esc(m.proposedSkill.description)}</p><div class="decision-actions">${needs?button('查看建议，由我决定','proposal','secondary small',`data-team="${t.id}" data-message="${m.id}"`):`<span class="badge muted">${m.status==='declined'?'未采纳':'已处理'}</span>`}</div></div>`;
  if(m.artifactId)body+=`<button class="chat-attachment" data-action="artifact" data-id="${m.artifactId}">${icon('file')}<span>${esc(artifactData[m.artifactId].title)}<small>${esc(artifactData[m.artifactId].status)}</small></span>${icon('chevron')}</button>`;
  return `<article class="chat-message ${self?'self':''} ${needs?'mention-message':''}" id="message-${m.id}"><div class="message-avatar">${avatar(m.sender)}</div><div class="message-main"><div class="message-meta"><b>${self?'我':esc(p?.name||'团队')}</b>${p?`<span>${esc(p.role)}</span>`:''}<time>${m.time}</time></div><div class="message-bubble">${body}</div></div></article>`;
}
function renderSummary(t) {
  const a=availability(t);
  return `<section class="summary-section"><div class="row between"><h3>团队进展</h3>${teamStatusBadge(t)}</div><p class="summary-goal">${esc(t.goal)}</p>${t.total?`<div class="row between small"><span>已完成 ${t.done}/${t.total} 项</span><span class="muted">演示进度</span></div><div class="mini-progress"><i style="width:${Math.round(t.done/t.total*100)}%"></i></div>`:t.members.length?'<p class="muted small">直接在群聊中交给团队一个目标。</p>':`<p class="muted small">目标消息会保留；先创建员工，团队才能开始工作。</p>${button('从模板创建员工','new-member','secondary small',`data-team="${t.id}"`)}`}<div class="availability"><span><b>${a.working}</b>工作中</span><span><b>${a.idle}</b>空闲</span><span><b>${a.waiting}</b>等待</span></div></section><section class="summary-section"><div class="row between"><h3>团队成员</h3><a class="small" href="#/team/${t.id}">管理</a></div>${teamPeople(t).map(p=>`<button class="member-line" data-action="person" data-id="${p.id}">${avatar(p.id)}<span><b>${esc(p.name)}</b><small>${esc(p.role)}</small></span><span class="member-status ${p.status}">${({working:'工作中',idle:'空闲',waiting:'等待'})[p.status]}</span></button>`).join('')}</section>${t.tasks.length?`<section class="summary-section"><h3>当前安排</h3><div class="task-compact">${t.tasks.map(([name,s])=>`<div><span class="dot ${s==='done'?'green':s==='waiting'?'amber':'blue'}"></span><span>${esc(name)}</span>${s==='done'?icon('check'):''}</div>`).join('')}</div></section>`:''}<p class="demo-note">状态、进度与协作消息为演示内容，未连接真实执行。</p>`;
}
const artifactData={
  'biz-report':{teamId:'biz',title:'商机分析简报 · v2',status:'已修正 · 示例',content:'12 条合成商机已按统一口径整理。\n近期推进和长期潜力分别列出，最终优先级等待用户回复。\n旧版分母口径问题保留在历史记录中。'},
  'biz-review':{teamId:'biz',title:'简报 v2 核查记录',status:'复核完成 · 示例',content:'检查对象：业务洞察团队的商机分析简报 v2。\n历史问题：初稿分母口径不一致。\n后续处理：江禾修正，禾宁对新版本复核。\n示例 8 项数据已重新核对；优先级方案仍待用户决定。'},
  'dev-plan':{teamId:'dev',title:'搜索体验方案 · v1',status:'方案说明 · 尚未验证实现',content:'检查搜索词保留、空结果和键盘访问。\n当前是研发协作团队的示例方案，没有实际代码与测试结果。'},
};
function initialTemplateChat() {
  return {input:'',busy:false,draft:null,revision:0,messages:[{role:'assistant',text:'你想创建怎样的数字员工？可以先聊它要做什么、具备什么能力、如何与团队协作。我会把讨论整理成模板草稿，你可以继续补充和修改。'}]};
}
function renderTemplateStudio() {
  const chat=state.templateChat||(state.templateChat=initialTemplateChat()),draft=chat.draft;
  return `<div class="template-studio"><section class="studio-conversation"><header class="studio-chat-header"><div><button class="breadcrumb-button" data-action="go-templates">${icon('back')} 返回模板</button><h2>聊聊你需要的数字员工</h2><p class="muted small">通过对话逐步完善工作 Prompt 和 Skills</p></div><span class="badge muted">本地生成演示</span></header><div class="studio-chat-feed" id="studio-chat-feed">${chat.messages.map(m=>`<article class="studio-message ${m.role==='user'?'self':''}"><span class="avatar ${m.role==='user'?'blue':'violet'}">${m.role==='user'?'我':icon('spark')}</span><div class="studio-message-body"><p>${esc(m.text).replace(/\n/g,'<br>')}</p>${m.draft?button('查看模板草稿','show-template-draft','secondary small'):''}</div></article>`).join('')}${chat.busy?'<div class="studio-message"><span class="avatar violet">…</span><div class="studio-message-body"><p>正在把这轮要求整理到草稿…</p></div></div>':''}</div><form class="studio-composer" data-form="template-chat"><textarea id="template-chat-input" aria-label="模板创建对话" placeholder="描述你需要的员工，或继续补充、调整能力与工作方式…">${esc(chat.input)}</textarea><div class="composer-foot"><span class="composer-hint">模拟对话，不会调用真实模型；草稿经你保存后才成为模板。</span><button class="btn primary" type="submit" ${chat.busy?'disabled':''}>发送 ${icon('arrow')}</button></div></form></section><details class="studio-draft" ${window.innerWidth>768?'open':''}><summary class="studio-draft-head"><h3>模板草稿</h3><span class="badge ${draft?'blue':'muted'}">${draft?`第 ${chat.revision} 轮`:'等待对话'}</span>${icon('down')}</summary><div class="studio-draft-body">${draft?`<div class="field"><label class="field-label" for="studio-draft-name">模板名称</label><input class="input" id="studio-draft-name" value="${esc(draft.name)}"></div><div class="field"><label class="field-label" for="studio-draft-prompt">工作 Prompt</label><textarea class="input" id="studio-draft-prompt" rows="12">${esc(draft.prompt)}</textarea></div><div class="field"><h3>能力 Skills</h3><div class="skill-pills">${draft.skills.map(s=>`<span class="skill-pill" title="${esc(s.content)}">${esc(s.name)}</span>`).join('')}</div><p class="muted small">继续对话补充能力；保存后也能逐项编辑 Skill。</p></div>`:'<div class="draft-empty"><span class="template-mark">'+icon('file')+'</span><h3>边聊边完善模板</h3><p>开始对话后，模板名称、工作 Prompt 和 Skills 会显示在这里。你可以继续沟通，也可以直接修改草稿。</p></div>'}</div><div class="studio-draft-foot"><button class="btn primary" data-action="save-conversation-template" ${!draft||chat.busy?'disabled':''}>保存为数字员工模板 ${icon('check')}</button><p class="demo-note">保存模板后，再为团队创建专属员工。</p></div></details></div>`;
}
function scrollTemplateChat() {
  requestAnimationFrame(()=>{const feed=document.querySelector('#studio-chat-feed');if(feed)feed.scrollTop=feed.scrollHeight;});
}
function sendTemplateChat() {
  const chat=state.templateChat,text=value('template-chat-input');if(chat.busy||!text)return;
  chat.messages.push({role:'user',text});chat.input='';chat.busy=true;render();scrollTemplateChat();
  setTimeout(()=>{
    if(state.templateChat!==chat)return;
    updateTemplateDraft(chat,text);chat.busy=false;
    chat.messages.push({role:'assistant',draft:true,text:`已将这轮要求整理到模板草稿（第 ${chat.revision} 轮，本地演示）。\n你可以继续补充工作方式、需要的 Skill，或修改名称；草稿也可以直接编辑，满意后再保存。`});
    if(route().page==='studio'){render();scrollTemplateChat();}
  },550);
}
function updateTemplateDraft(chat,text) {
  const nameMatch=text.match(/(?:名称(?:改为|设为|叫|是|为|[:：])|(?:改名|命名|取名)(?:为|叫)?)[“「"\s]*([^”」"\n，。；]{1,24})/);
  if(!chat.draft)chat.draft={name:nameMatch?.[1]?.trim()||'自定义数字员工',prompt:`${text}\n\n围绕目标自主选择方法，与团队核查成果；拿不准时先向直属上级评估。员工模板可自迭代并保留来源；新增员工或调整团队流程只提出建议。`,skills:[skill('work-method','目标理解与执行','根据目标和资料选择工作方法。',text),skill('collaboration','协作与升级','与团队协作核查，拿不准时逐级评估。','保留事实依据，主动沟通；无法确定的方案先向直属上级评估。')]};
  else {if(nameMatch)chat.draft.name=nameMatch[1].trim();chat.draft.prompt+=`\n\n补充要求：${text}`;chat.draft.skills[0].content+=`\n${text}`;}
  if(/核对|核查|验证|复核/.test(text)&&!chat.draft.skills.some(s=>s.id==='fact-check'))chat.draft.skills.push(skill('fact-check','事实与结果核查','核对来源、口径与结果，保留未确定内容。','针对实际资料和产物核对，不将推断或未执行检查表述为已验证。'));
  const skillMatch=text.match(/(?:新增|添加|增加|补充)(?:一个|一项)?\s*(?:skill|技能|能力)[：:\s“「"]*([^”」"\n，。；]{1,24})/i);
  if(skillMatch&&!chat.draft.skills.some(s=>s.name===skillMatch[1].trim()))chat.draft.skills.push(skill(`custom-${Date.now()}`,skillMatch[1].trim(),'来自本轮对话，可保存后继续编辑。',text));
  chat.revision++;
}
function saveConversationTemplate() {
  const chat=state.templateChat;if(!chat?.draft||chat.busy)return;
  const draft=chat.draft,name=value('studio-draft-name'),prompt=value('studio-draft-prompt');
  if(!name||!prompt)return toast('请填写模板名称与工作 Prompt。');
  const tpl={id:`template-${Date.now()}`,name,description:'通过对话整理的模板，可继续编辑 Prompt 与 Skills。',icon:'person',color:'violet',version:1,prompt,skills:structuredClone(draft.skills),sourceConversation:structuredClone(chat.messages)};
  state.templates.push(tpl);recordTemplateRevision(tpl,'user','user','对话创建模板');navigate(`template/${tpl.id}`);toast('对话草稿已保存为模板，可以为团队创建员工 · 演示');
}
function showTemplateDraft() {
  const draft=document.querySelector('.studio-draft');if(!draft)return;draft.open=true;if(window.innerWidth<=768)draft.scrollIntoView({behavior:'smooth',block:'start'});
}
function renderTemplates() {
  return `${pageHead('数字员工模板','通过对话创建模板，支持员工自迭代工作 Prompt 与 Skills，再为团队创建员工。',button(`${icon('spark')} 对话创建模板`,'new-template','primary'))}<div class="notice info">模板可以重复使用；每次创建的员工都是独立身份，只属于一个团队。模板更新对既有员工的同步方式待确认。</div><div class="templates-grid">${state.templates.map(t=>`<article class="card template-card"><div class="row between"><span class="template-mark ${t.color}">${icon(t.icon)}</span><span class="badge muted">v${t.version}</span></div><h3>${esc(t.name)}</h3><p class="muted small">${esc(t.description)}</p><div class="skill-pills">${t.skills.map(s=>`<span class="skill-pill">${esc(s.name)}</span>`).join('')}</div><div class="row between"><span class="small muted">已创建 ${state.people.filter(p=>p.templateId===t.id).length} 位员工</span><a class="btn secondary small" href="#/template/${t.id}">管理模板 ${icon('arrow')}</a></div></article>`).join('')}</div>`;
}
function renderTemplate(id) {
  const t=template(id);if(!t)return notFound();
  return `<button class="breadcrumb-button" data-action="go-templates">${icon('back')} 返回模板</button>${pageHead(esc(t.name),`可自迭代 · ${t.skills.length} 个 Skills · 模板 v${t.version}`,templateEvolutionActions(t)+button(`${icon('plus')} 用模板创建员工`,'create-from-template','primary',`data-id="${t.id}"`))}<div class="notice info">模板定义可自迭代的工作 Prompt 与 Skills，每次变更保留来源和版本。已有员工何时采用新版仍待确定。</div><div class="grid two" style="margin-top:20px"><section class="card"><div class="card-head"><h3>工作 Prompt</h3></div><form class="card-body" data-form="save-template" data-id="${t.id}"><div class="field"><label class="field-label" for="template-name">模板名称</label><input class="input" id="template-name" value="${esc(t.name)}"></div><div class="field"><label class="field-label" for="template-prompt">如何工作</label><textarea class="input" id="template-prompt" rows="12">${esc(t.prompt)}</textarea></div><button class="btn primary" type="submit">保存工作 Prompt</button></form></section><section class="card"><div class="card-head"><h3>能力 Skills</h3>${button(`${icon('plus')} 添加 Skill`,'new-skill','secondary small',`data-template="${t.id}"`)}</div><div class="card-body skill-list">${t.skills.map(s=>`<div class="skill-item"><div><h3>${esc(s.name)}</h3><p class="muted small">${esc(s.description)}</p></div><button class="btn ghost small" data-action="edit-skill" data-template="${t.id}" data-id="${s.id}">查看 / 编辑</button></div>`).join('')||'<p class="muted">还没有 Skill，可以添加自己的方法与规则。</p>'}</div><div class="card-body"><p class="demo-note">Skills 是可持续编辑的工作能力，不构成固定岗位或工具白名单。</p></div></section></div>`;
}
function memberRow(p) {
  const tpl=template(p.templateId);
  return `<div class="member-row">${avatar(p.id)}<div class="member-info"><b>${esc(p.name)}</b><span>${esc(p.role)}</span><small>来自 ${esc(tpl.name)} v${p.templateVersion} · 最新 v${tpl.version} · 上级：${p.parentId==='user'?'我':esc(person(p.parentId)?.name||'待配置')}</small></div><span class="member-status ${p.status}">${({working:'工作中',idle:'空闲',waiting:'等待'})[p.status]}</span><button class="btn ghost small member-knowledge-button" data-action="knowledge-employee-mounts" data-employee="${p.id}">知识 ${state.knowledgeMounts.filter(m=>m.employeeId===p.id).length}</button><button class="icon-btn" data-action="person" data-id="${p.id}" aria-label="查看${esc(p.name)}">${icon('chevron')}</button></div>`;
}
function renderTeams() {
  return `${pageHead('团队','选择一个团队，进入详情管理员工、项目库与协作配置。',button(`${icon('plus')} 新建团队`,'new-team','primary'))}<div class="teams-grid team-directory">${state.teams.map(t=>{const projects=state.projects.filter(p=>p.teamId===t.id);return `<a class="card team-directory-card" href="#/team/${t.id}"><div class="team-directory-head"><span class="channel-icon ${t.color}">${icon(t.icon)}</span>${teamStatusBadge(t)}</div><h3>${esc(t.name)}</h3><div class="team-directory-about"><small>产品 / 模块描述</small><p>${esc(t.description)||'可在团队详情补充负责的产品、模块或业务范围。'}</p></div><div class="team-directory-projects"><small>负责项目</small><p>${projects.length?esc(projects.slice(0,2).map(p=>p.name).join('、'))+(projects.length>2?` 等 ${projects.length} 个项目`:''):'暂无项目'}</p></div><div class="team-directory-stats"><span><b>${t.members.length}</b>位数字员工</span><span><b>${projects.length}</b>个项目</span></div><div class="team-directory-foot"><span>进入团队管理</span>${icon('arrow')}</div></a>`;}).join('')}</div>`;
}
function teamTabs(teamId,active) {
  const count=state.projects.filter(p=>p.teamId===teamId).length;
  return `<nav class="team-subnav" aria-label="团队内容"><a class="${active==='members'?'active':''}" href="#/team/${teamId}">团队成员</a><a class="${active==='library'?'active':''}" href="#/library/${teamId}">项目库 <span>${count}</span></a><a class="${active==='knowledge'?'active':''}" href="#/employee-knowledge/${teamId}">员工知识 <span>${state.knowledgeMounts.filter(m=>team(teamId).members.includes(m.employeeId)).length}</span></a></nav>`;
}
function renderTeam(id) {
  const t=team(id);if(!t)return notFound();
  return `<button class="breadcrumb-button" data-action="go-teams">${icon('back')} 返回团队</button>${pageHead(esc(t.name),esc(t.description),`${button('编辑简介','team-profile','secondary',`data-id="${t.id}"`)}<a class="btn secondary" href="#/overview/${t.id}">进入群聊</a>${button(`${icon('plus')} 从模板创建员工`,'new-member','primary',`data-team="${t.id}"`)}`)}${teamTabs(t.id,'members')}<section class="card"><div class="card-head"><h3>团队成员</h3><span class="badge muted">${t.members.length} 位 · 均为本团队专属</span></div><div class="member-list">${teamPeople(t).map(memberRow).join('')||'<div class="empty">先从模板创建员工，团队才有实际成员。</div>'}</div></section><details class="card team-flow" style="margin-top:20px"><summary>团队流程 Prompt <span class="muted small">v${t.flowVersion} · 按需展开</span></summary><form class="card-body" data-form="save-flow" data-team="${t.id}"><textarea class="input" id="team-flow" rows="8">${esc(t.flow)}</textarea><div class="row between" style="margin-top:14px"><span class="demo-note">对当前工作的生效方式仍待确认。</span><button class="btn primary" type="submit">保存流程 Prompt</button></div></form></details>`;
}
function notFound() {return '<div class="empty"><h2>没有找到这项内容</h2><a href="#/overview" class="btn primary">返回工作台</a></div>';}

function openModal(type,extra={}) {state.drawer=null;state.modal={type,...extra};renderOverlay();}
function openDrawer(type,extra={}) {state.modal=null;state.drawer={type,...extra};renderOverlay();}
function closeOverlay(){state.modal=null;state.drawer=null;renderOverlay();}
function renderOverlay() {
  const current=state.drawer||state.modal;document.body.classList.toggle('drawer-open',Boolean(current));
  if(!current){document.querySelector('#overlays').innerHTML='';return;}
  const p=state.drawer?drawerParts(current):modalParts(current);
  document.querySelector('#overlays').innerHTML=`<div class="overlay" data-backdrop="true"><section class="${state.drawer?'drawer':'modal'}" role="dialog" aria-modal="true" aria-labelledby="overlay-title"><div class="drawer-head"><div><span class="eyebrow">${p.kicker||'交互演示'}</span><h2 id="overlay-title">${p.title}</h2></div><button class="icon-btn" data-action="close" aria-label="关闭">${icon('close')}</button></div><div class="drawer-body">${p.body}</div>${p.foot?`<div class="drawer-foot">${p.foot}</div>`:''}</section></div>`;
}
function messageFrom(teamId,id){return team(teamId)?.messages.find(m=>m.id===id);}
function drawerParts(d) {
  const knowledge=knowledgeDrawer(d);if(knowledge)return knowledge;
  const evolution=templateEvolutionDrawer(d);if(evolution)return evolution;
  const project=projectDrawer(d);if(project)return project;
  if(d.type==='summary')return {title:esc(team(d.teamId).name),body:renderSummary(team(d.teamId)),foot:button('关闭','close')};
  if(d.type==='person')return personDrawer(person(d.id));
  if(d.type==='trace')return traceDrawer(team(d.teamId),messageFrom(d.teamId,d.messageId));
  if(d.type==='proposal')return proposalDrawer(team(d.teamId),messageFrom(d.teamId,d.messageId));
  if(d.type==='artifact'){const a=artifactData[d.id];return {kicker:`${esc(team(a.teamId).name)} · 本团队产物`,title:esc(a.title),body:`<span class="badge muted">${esc(a.status)}</span><div class="artifact-preview"><pre>${esc(a.content)}</pre></div><p class="demo-note">仅为本团队的合成示例，没有执行真实核查或外部动作。</p>`,foot:`<a class="btn secondary" href="#/library/${a.teamId}">前往团队项目库</a>${button('关闭','close')}`};}
  return {title:'详情',body:''};
}
function personDrawer(p) {
  const t=team(p.teamId),tpl=template(p.templateId);
  return {kicker:'团队专属数字员工',title:esc(p.name),body:`<div class="row">${avatar(p.id)}<div><h3>${esc(p.role)}</h3><p class="muted small">只属于 ${esc(t.name)}</p></div></div><div class="detail-block"><h3>员工来源</h3><p>从「${esc(tpl.name)}」模板 v${p.templateVersion} 创建 · 最新可用 v${tpl.version}</p><p class="muted small">这是独立员工，其他团队使用同一模板时会创建新的身份。</p></div><div class="detail-block"><h3>直属上级</h3><p>${p.parentId==='user'?'我 · 最终决定人':esc(person(p.parentId)?.name||'待配置')}</p></div><div class="detail-block"><h3>创建时的 Skills</h3><div class="skill-pills">${p.skills.map(s=>`<span class="skill-pill">${esc(s.name)}</span>`).join('')}</div></div><div class="detail-block"><h3>工作 Prompt</h3><pre>${esc(p.prompt)}</pre></div><div class="detail-block"><h3>挂载知识</h3>${employeeKnowledgeSummary(p.id)}${button('管理挂载','knowledge-employee-mounts','secondary small',`data-employee="${p.id}"`)}</div><p class="demo-note">这里展示创建时的配置；模板更新如何同步到既有员工仍待确认。</p>`,foot:`${button('关闭','close')}<a class="btn primary" href="#/template/${p.templateId}">管理来源模板</a>`};
}
function traceDrawer(t,m) {
  const trace=m.trace||[];
  return {kicker:'群聊中的逐级上报',title:'这个问题怎样到你这里',body:`<div class="notice amber"><b>${esc(m.question)}</b><p>${esc(t.name)} · ${m.status==='needs-user'?'等你回复':m.status==='followup'?'正在补充评估，尚未解决':'你已回复'}</p></div><div class="timeline">${trace.map(([name,label,text])=>`<div class="timeline-item"><b>${esc(name)} · ${esc(label)}</b><p>${esc(text)}</p></div>`).join('')}</div>${m.response?`<div class="detail-block"><h3>你的回复</h3><p>${esc(m.response)}</p></div>`:''}<p class="demo-note">单一直属上级是本次演示形式。打开、阅读这条 @消息不会自动提交决定。</p>`,foot:`${button('关闭','close')}${m.status==='needs-user'?button('回群聊回复','reply-message','primary',`data-team="${t.id}" data-message="${m.id}"`):''}`};
}
function proposalDrawer(t,m) {
  const tpl=template(m.templateId),s=m.proposedSkill;const pending=m.status==='needs-user';
  return {kicker:'员工建议 · 尚未自动生效',title:'建议补充模板的 Skill',body:`<p>${esc(person(m.sender).name)} 在「${esc(t.name)}」中提交的建议。</p><div class="detail-block"><h3>目标模板</h3><p>${esc(tpl.name)} · 当前 v${tpl.version}</p></div><div class="detail-block"><h3>${esc(s.name)}</h3><p>${esc(s.description)}</p><pre>${esc(s.content)}</pre></div><div class="notice info">${pending?'这条建议等待你处理；员工也可以自迭代模板并保存版本。':'这项建议已经处理。'}既有员工的同步策略仍待确认；本演示不自动更新已创建员工。</div>`,foot:pending?`${button('不采纳','decline-proposal','secondary',`data-team="${t.id}" data-message="${m.id}"`)}${button('采纳为模板新版本','apply-proposal','primary',`data-team="${t.id}" data-message="${m.id}"`)}`:button('关闭','close')};
}
function modalParts(m) {
  const knowledge=knowledgeModal(m);if(knowledge)return knowledge;
  const evolution=templateEvolutionModal(m);if(evolution)return evolution;
  const project=projectModal(m);if(project)return project;
  if(m.type==='team-profile')return teamProfileModal(team(m.teamId));
  if(m.type==='skill')return skillModal(m);
  if(m.type==='new-member')return memberModal(m);
  if(m.type==='new-team')return {kicker:'团队',title:'新建一个团队',body:`<form id="new-team-form" data-form="new-team"><div class="field"><label class="field-label" for="team-name">团队名称</label><input class="input" id="team-name" placeholder="例如：客户研究团队"></div><div class="field"><label class="field-label" for="team-description">产品 / 模块描述或业务说明</label><textarea class="input" id="team-description" placeholder="用自己的话描述目标与分工，不限制行业或岗位…"></textarea></div><p class="muted small">创建后，从数字员工模板为这个团队创建专属成员。</p></form>`,foot:`${button('取消','close')}<button class="btn primary" type="submit" form="new-team-form">创建团队</button>`};
  return {kicker:'交互原型 v0.5',title:'围绕团队群聊组织工作',body:'<div class="detail-block"><h3>工作台：群聊就是工作现场</h3><p>选择不同团队，看进展与空闲程度。需要你的事项通过 @我 消息提示，在群里回复。</p></div><div class="detail-block"><h3>数字员工模板：管理能力与 Skills</h3><p>通过对话生成并完善模板草稿，保存后管理工作 Prompt 和 Skills。模板可以复用；实际员工不跨团队。</p></div><div class="detail-block"><h3>团队：管理专属成员</h3><p>从模板创建专属员工，管理团队项目库、归档文档并查看并行需求与版本。团队流程按需展开。</p></div><div class="detail-block"><h3>知识库：资料按员工挂载</h3><p>共享资料对员工只读，更新后挂载员工可见。员工模板可以自迭代，保留历史与来源。</p></div><div class="notice info">全部为本地合成演示；没有真实模型、后台或业务系统。刷新可重置。模板对既有员工的同步、层级及在途生效规则仍待确认。</div>',foot:`${button('重置演示','reset')}${button('开始体验','close','primary')}`};
}
function teamProfileModal(t) {
  return {kicker:'团队简介',title:'编辑团队简介',body:`<form id="team-profile-form" data-form="team-profile" data-team="${t.id}"><div class="field"><label class="field-label" for="team-profile-name">团队名称</label><input class="input" id="team-profile-name" value="${esc(t.name)}"></div><div class="field"><label class="field-label" for="team-profile-description">产品 / 模块描述或业务范围</label><textarea class="input" id="team-profile-description" rows="6" placeholder="可以描述负责的产品、模块或业务范围…">${esc(t.description)}</textarea></div><p class="demo-note">员工人数和负责项目根据团队当前数据展示，在各自管理页面维护。</p></form>`,foot:`${button('取消','close')}<button class="btn primary" form="team-profile-form" type="submit">保存简介</button>`};
}
function saveTeamProfile(form) {
  const t=team(form.dataset.team),name=value('team-profile-name');if(!name)return toast('请填写团队名称。');
  t.name=name;t.description=value('team-profile-description');closeOverlay();render();toast('团队简介已更新 · 本地演示');
}
function skillModal(m) {
  const tpl=template(m.templateId);const s=tpl.skills.find(s=>s.id===m.skillId)||{name:'',description:'',content:''};
  return {kicker:`${esc(tpl.name)} · 能力 Skill`,title:m.skillId?'编辑 Skill':'添加 Skill',body:`<form id="skill-form" data-form="save-skill" data-template="${tpl.id}" data-id="${m.skillId||''}"><div class="field"><label class="field-label" for="skill-name">Skill 名称</label><input class="input" id="skill-name" value="${esc(s.name)}" placeholder="用你的方式命名能力"></div><div class="field"><label class="field-label" for="skill-description">什么时候使用，解决什么问题</label><input class="input" id="skill-description" value="${esc(s.description)}"></div><div class="field"><label class="field-label" for="skill-content">工作方法与说明</label><textarea class="input" id="skill-content" rows="9" placeholder="填写可复用的方法、步骤、参考或检查要求…">${esc(s.content)}</textarea></div><p class="demo-note">本次保存模板新版本。既有员工如何采用更新仍待确认。</p></form>`,foot:`${m.skillId?button('删除 Skill','delete-skill','danger',`data-template="${tpl.id}" data-id="${m.skillId}"`):button('取消','close')}<button class="btn primary" form="skill-form" type="submit">保存 Skill</button>`};
}
function memberModal(m) {
  const selectedTeam=team(m.teamId)||state.teams[0];
  if(!selectedTeam)return {title:'先创建一个团队',body:'员工需要明确归属的团队。',foot:button('关闭','close')};
  return {kicker:'从模板创建 · 新的独立身份',title:'为团队创建一位员工',body:`<form id="member-form" data-form="new-member"><div class="field"><label class="field-label" for="member-team">所属团队</label><select class="select" id="member-team">${state.teams.map(t=>`<option value="${t.id}" ${t.id===selectedTeam.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select></div><div class="field"><label class="field-label" for="member-template">数字员工模板</label><select class="select" id="member-template">${state.templates.map(t=>`<option value="${t.id}" ${t.id===m.templateId?'selected':''}>${esc(t.name)} · v${t.version} · ${t.skills.length} 个 Skills</option>`).join('')}</select></div><div class="field"><label class="field-label" for="member-name">员工名称</label><input class="input" id="member-name" placeholder="为这位员工起一个名字"></div><div class="field"><label class="field-label" for="member-role">本团队的主要分工</label><input class="input" id="member-role" placeholder="例如：资料分析、方案评估，也可以自行描述"></div><div class="field"><label class="field-label" for="member-parent">直属上级</label><select class="select" id="member-parent">${parentOptions(selectedTeam)}</select></div><div class="notice info">本次会从模板创建新员工，只加入所选团队。这里不选择或借用其他团队的员工。</div></form>`,foot:`${button('取消','close')}<button class="btn primary" form="member-form" type="submit">创建员工</button>`};
}
function parentOptions(t) {return `<option value="user">我 · 最终决定人</option>${teamPeople(t).map(p=>`<option value="${p.id}">${esc(p.name)} · ${esc(p.role)}</option>`).join('')}`;}
function toast(message){clearTimeout(state.toastTimer);const el=document.querySelector('#toast');el.innerHTML=`${icon('check')}<span>${esc(message)}</span>`;el.hidden=false;state.toastTimer=setTimeout(()=>el.hidden=true,2800);}
function scrollChat(id) {requestAnimationFrame(()=>{const feed=document.querySelector('#chat-feed');const target=id?document.querySelector(`#message-${id}`):null;if(target)target.scrollIntoView({block:'center',behavior:'smooth'});else if(feed)feed.scrollTop=feed.scrollHeight;});}
function replyTo(teamId,messageId){closeOverlay();state.mentionOnly=false;state.replyTo={teamId,messageId};if(state.activeTeamId!==teamId){state.activeTeamId=teamId;history.replaceState(null,'',`#/overview/${teamId}`);}render();requestAnimationFrame(()=>document.querySelector('#chat-input')?.focus());}
function updateAvailability(t) {
  if(t.status==='paused')return;
  const waits=t.messages.some(m=>m.kind==='decision'&&m.status==='needs-user');
  t.status=waits?'waiting':t.total>t.done?'working':'idle';
  const lead=teamPeople(t).find(p=>p.parentId==='user');if(lead)lead.status=waits?'waiting':t.status==='working'?'working':'idle';
}
function sendChat(form) {
  const t=team(form.dataset.team);const value=document.querySelector('#chat-input').value.trim();if(!value)return toast('先写下目标、补充说明或你的回复。');
  const reply=state.replyTo?.teamId===t.id?messageFrom(t.id,state.replyTo.messageId):null;
  t.messages.push({id:`user-${Date.now()}`,sender:'user',time:'刚刚',text:value});
  if(reply?.kind==='decision'){reply.status='responded';reply.response=value;}
  if(!t.members.length){t.goal=value;state.replyTo=null;state.mentionOnly=false;render();scrollChat();toast('消息已保留，先从模板创建员工再开始协作 · 演示');return;}
  if(!t.total){t.goal=value;t.total=3;t.done=0;t.tasks=[['整理目标与已有资料','working'],['根据目标自主推进','pending'],['核查与整理成果','pending']];}
  state.replyTo=null;state.mentionOnly=false;updateAvailability(t);render();scrollChat();
  if(t.status!=='paused'&&t.members.length)setTimeout(()=>{t.messages.push({id:`ack-${Date.now()}`,sender:t.members[0],time:'刚刚',text:reply?'已收到你的回复，会结合现有目标继续安排工作，并在这里保留进展与依据。':'收到。我会结合目标与资料安排协作，有拿不准的方案先向上级评估。'});if(route().page==='overview'&&state.activeTeamId===t.id){render();scrollChat();}},450);
}
function createMember() {
  const t=team(document.querySelector('#member-team').value),tpl=template(document.querySelector('#member-template').value);
  const name=document.querySelector('#member-name').value.trim();if(!name)return toast('请给这位新员工起一个名字。');
  const parentId=document.querySelector('#member-parent').value;
  if(parentId!=='user'&&!t.members.includes(parentId))return toast('上级只能是本团队员工或你。');
  const p={id:`employee-${Date.now()}-${state.people.length}`,name,role:document.querySelector('#member-role').value.trim()||tpl.name,color:['blue','violet','green','orange'][state.people.length%4],teamId:t.id,templateId:tpl.id,templateVersion:tpl.version,parentId,status:'idle',prompt:tpl.prompt,skills:structuredClone(tpl.skills)};
  state.people.push(p);t.members.push(p.id);state.modal=null;navigate(`team/${t.id}`);toast('已从模板创建新员工，仅归属这个团队 · 演示');
}
function applyProposal(teamId,messageId,accept) {
  const t=team(teamId),m=messageFrom(teamId,messageId);if(m.status!=='needs-user')return;
  if(accept){const tpl=template(m.templateId);tpl.skills.push({...m.proposedSkill,id:`skill-${Date.now()}`});tpl.version++;recordTemplateRevision(tpl,'user','user','用户采纳模板建议');m.status='accepted';}else m.status='declined';
  t.messages.push({id:`decision-${Date.now()}`,sender:'user',time:'刚刚',text:accept?'采纳这项建议，保存为模板新版本。既有员工如何同步更新，后续再明确。':'这项模板调整建议暂不采纳，保留当前配置。'});closeOverlay();render();scrollChat();toast(accept?'模板新版本已保存；没有自动更新既有员工 · 演示':'未采纳，模板保持原样');
}
const value=id=>document.getElementById(id)?.value.trim()||'';
function saveTemplate(form) {
  const tpl=template(form.dataset.id),name=value('template-name'),prompt=value('template-prompt');
  if(!name||!prompt)return toast('请填写模板名称与工作 Prompt。');
  tpl.name=name;tpl.prompt=prompt;tpl.version++;recordTemplateRevision(tpl,'user','user','用户修改工作 Prompt');render();toast('模板新版本已保存；既有员工同步方式待确认 · 演示');
}
function saveSkill(form) {
  const tpl=template(form.dataset.template),name=value('skill-name'),content=value('skill-content');
  if(!name||!content)return toast('请填写 Skill 名称与工作方法。');
  const existing=tpl.skills.find(s=>s.id===form.dataset.id);
  if(existing)Object.assign(existing,{name,description:value('skill-description'),content});
  else tpl.skills.push(skill(`skill-${Date.now()}`,name,value('skill-description'),content));
  tpl.version++;recordTemplateRevision(tpl,'user','user','用户保存 Skill');closeOverlay();render();toast('Skill 已保存为模板新版本 · 演示');
}
function deleteSkill(templateId,skillId) {
  const tpl=template(templateId);tpl.skills=tpl.skills.filter(s=>s.id!==skillId);tpl.version++;recordTemplateRevision(tpl,'user','user','用户删除 Skill');
  closeOverlay();render();toast('已从模板删除 Skill；既有员工保持创建时配置 · 演示');
}
function createTeam() {
  const name=value('team-name');if(!name)return toast('请填写团队名称。');
  const t={id:`team-${Date.now()}`,name,description:value('team-description')||'由你定义目标与协作方式。',icon:'users',color:'violet',status:'idle',goal:'暂无进行中的工作',done:0,total:0,flow:defaultFlow,flowVersion:1,members:[],tasks:[],messages:[]};
  state.teams.push(t);navigate(`team/${t.id}`);toast('团队已创建，从模板为它创建第一位员工 · 演示');
}
function saveFlow(form) {
  const t=team(form.dataset.team),flow=value('team-flow');if(!flow)return toast('请填写团队流程 Prompt。');
  t.flow=flow;t.flowVersion++;toast('流程 Prompt 已保存；当前工作如何采用新版本仍待确认 · 演示');
}
function handleAction(el) {
  if(handleKnowledgeAction(el)||handleTemplateEvolutionAction(el))return;
  if(handleProjectAction(el))return;
  const a=el.dataset.action,d=el.dataset;
  const actions={
    'nav-toggle':()=>document.body.classList.toggle('nav-open'),
    'channels-toggle':()=>document.body.classList.toggle('channels-open'),
    guide:()=>openModal('guide'),close:closeOverlay,
    'go-templates':()=>navigate('templates'),'go-teams':()=>navigate('teams'),
    'new-template':()=>{state.templateChat=initialTemplateChat();navigate('studio');},
    'save-conversation-template':saveConversationTemplate,
    'show-template-draft':showTemplateDraft,
    'create-from-template':()=>openModal('new-member',{templateId:d.id}),
    'new-member':()=>openModal('new-member',{teamId:d.team}),
    'new-skill':()=>openModal('skill',{templateId:d.template}),
    'edit-skill':()=>openModal('skill',{templateId:d.template,skillId:d.id}),
    'delete-skill':()=>deleteSkill(d.template,d.id),
    'new-team':()=>openModal('new-team'),
    'team-profile':()=>openModal('team-profile',{teamId:d.id}),
    'team-summary':()=>openDrawer('summary',{teamId:d.id}),
    person:()=>openDrawer('person',{id:d.id}),
    trace:()=>openDrawer('trace',{teamId:d.team,messageId:d.message}),
    proposal:()=>openDrawer('proposal',{teamId:d.team,messageId:d.message}),
    'reply-message':()=>replyTo(d.team,d.message),
    'cancel-reply':()=>{state.replyTo=null;render();},
    'toggle-mentions':()=>{state.mentionOnly=!state.mentionOnly;render();scrollChat();},
    'show-all':()=>{state.mentionOnly=false;render();scrollChat();},
    artifact:()=>openDrawer('artifact',{id:d.id}),
    'apply-proposal':()=>applyProposal(d.team,d.message,true),
    'decline-proposal':()=>applyProposal(d.team,d.message,false),
    reset:()=>{clearTimeout(state.toastTimer);state=initialState();state.templateChat=initialTemplateChat();initProjectLibraries();initKnowledgeLibraries();initTemplateEvolution();document.querySelector('#toast').hidden=true;navigate('overview');},
  };
  actions[a]?.();
}
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]');if(action){event.preventDefault();handleAction(action);return;}
  if(event.target.matches('[data-backdrop]'))closeOverlay();
});
document.addEventListener('submit',event=>{
  const form=event.target;if(!form.dataset.form)return;event.preventDefault();
  if(handleKnowledgeForm(form)||handleTemplateEvolutionForm(form)||handleProjectForm(form))return;
  const forms={chat:sendChat,'template-chat':sendTemplateChat,'save-template':saveTemplate,'save-skill':saveSkill,'new-team':createTeam,'team-profile':saveTeamProfile,'new-member':createMember,'save-flow':saveFlow};
  forms[form.dataset.form]?.(form);
});
document.addEventListener('change',event=>{
  if(event.target.id==='member-team')document.querySelector('#member-parent').innerHTML=parentOptions(team(event.target.value));
});
document.addEventListener('input',event=>{
  const chat=state.templateChat;if(!chat)return;
  if(event.target.id==='template-chat-input')chat.input=event.target.value;
  if(event.target.id==='studio-draft-name'&&chat.draft)chat.draft.name=event.target.value;
  if(event.target.id==='studio-draft-prompt'&&chat.draft)chat.draft.prompt=event.target.value;
});
document.addEventListener('toggle',event=>{
  if(event.target.matches('.studio-draft')&&window.innerWidth>768&&!event.target.open)event.target.open=true;
},true);
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeOverlay();document.body.classList.remove('nav-open','channels-open');}
  if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)&&['chat-input','template-chat-input'].includes(event.target.id)){event.preventDefault();event.target.form.requestSubmit();}
});
window.addEventListener('hashchange',()=>{closeOverlay();state.replyTo=null;state.mentionOnly=false;document.body.classList.remove('nav-open','channels-open');render();scrollChat();});
initProjectLibraries();
initKnowledgeLibraries();
initTemplateEvolution();
render();scrollChat();
