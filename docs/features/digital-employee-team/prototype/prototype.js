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
const defaultFlow = '围绕工作目标自主拆解任务，选择合适的员工、方法和工具协作，不要求固定步骤。\n重要产物由其他员工核查；发现问题后安排修正，并记录复核依据。\n拿不准方案时先提交直属上级；逐级仍无法解决，再汇总问题与方案反馈给我。\n新增员工、修改员工或团队流程 Prompt，只提出建议，由我决定。';
function employee(id, name, role, color, skills, teamIds) {
  return { id, name, role, color, skills, teamIds, version: 1,
    prompt: `你是${name}，当前主要承担${role}。\n结合目标与上下文自主选择工作方法，与团队协作，形成可检查的成果。\n职责用于分工，不限制你发现问题、补充知识、使用可用工具或协助其他员工。\n拿不准时向当前上级提交问题、依据和候选方案。长期工作规则的调整只提出建议，等待用户决定。` };
}
function freshState() {
  return {
    employees: [
      employee('lin', '林岚', '团队协调与方案评估', 'blue', ['目标澄清','组织协作','方案评估'], ['biz','dev']),
      employee('cheng', '程野', '方案设计', 'violet', ['系统分析','方案推演','资料研究'], ['dev']),
      employee('xu', '许澄', '开发与自动化', 'green', ['代码实现','数据处理','工具组合'], ['dev']),
      employee('zhou', '周予', '质量核查', 'orange', ['独立核验','问题定位','结果复核'], ['dev','biz']),
      employee('jiang', '江禾', '业务分析', 'violet', ['资料分析','数据洞察','建议整理'], ['biz']),
    ],
    teams: [
      { id:'biz', name:'业务洞察团队', icon:'activity', color:'violet', desc:'从资料中识别机会，形成有依据的业务建议。', members:['lin','jiang','zhou'], parents:{lin:'user',jiang:'lin',zhou:'lin'}, version:2, flow:defaultFlow },
      { id:'dev', name:'研发协作团队', icon:'code', color:'blue', desc:'围绕现有项目或新想法，自主完成分析、实现和验证。', members:['lin','cheng','xu','zhou'], parents:{lin:'user',cheng:'lin',xu:'cheng',zhou:'lin'}, version:3, flow:defaultFlow },
    ],
    runs: [
      { id:'biz-run', teamId:'biz', title:'形成本周商机跟进建议', goal:'根据给定的商机资料，梳理值得优先跟进的机会，形成可执行建议，并独立核查关键结论。', status:'waiting', progress:65, version:2,
        tasks:[['梳理资料与关键事实','江禾','done'],['形成建议并交叉核查','江禾 · 周予','done'],['明确优先级取舍','林岚 → 我','waiting'],['整理最终跟进建议','江禾','pending']],
        activities:[['jiang','已整理 12 条示例商机，提交分析初稿 v1。','09:32'],['zhou','发现转化率分母口径不一致，提出问题 Q-02。','09:38'],['jiang','按统一口径重新整理，提交分析简报 v2。','09:44'],['zhou','已复核 v2 的 8 项关键数据，Q-02 复核完成。','09:49'],['jiang','近期成交与长期潜力的优先级存在冲突，提交上级评估。','09:52'],['lin','资料缺少明确取舍依据，已将问题和两个方案反馈给你。','09:56']] },
      { id:'dev-run', teamId:'dev', title:'改进工作台的搜索体验', goal:'分析现有工作台的搜索体验，比较可行方案，完成有边界的改进，并验证关键交互。', status:'running', progress:42, version:3,
        tasks:[['理解目标与现有体验','程野','done'],['比较方案并明确取舍','程野 · 周予','done'],['完成交互改进','许澄','running'],['核查变更与关键路径','周予','pending']],
        activities:[['lin','已根据目标分派工作，当前计划可随反馈调整。','09:40'],['cheng','比较了两种筛选交互，已记录选择依据。','09:48'],['zhou','补充了空结果与键盘操作的核查要点。','09:53'],['xu','正在处理搜索交互，同时准备可复核的变更说明。','10:02']] },
    ],
    decisions: [
      {id:'priority', type:'escalation', runId:'biz-run', title:'本周商机跟进以什么为优先？', from:'林岚', status:'pending'},
      {id:'review-prompt', type:'proposal', employeeId:'zhou', title:'建议补充关键指标的复核要求', from:'周予', status:'pending'},
    ],
    tools:[{name:'文件与资料', icon:'file', desc:'读取、整理与保存工作资料',state:'示例可用'},{name:'脚本与终端',icon:'code',desc:'编写辅助脚本，组合执行方法',state:'示例可用'},{name:'浏览器',icon:'search',desc:'查找资料与查看页面',state:'示例可用'},{name:'团队知识',icon:'link',desc:'引用既有事实与工作经验',state:'示例可用'}],
    drawer:null, modal:null, teamTab:'organization', runTab:'activity', employeeFilter:'', inboxFilter:'pending', toastTimer:null, generationToken:0,
  };
}
let state = freshState();
const emp = id => state.employees.find(e => e.id === id);
const team = id => state.teams.find(t => t.id === id);
const run = id => state.runs.find(r => r.id === id);
const pending = () => state.decisions.filter(d => d.status === 'pending');
const avatar = (id, extra='') => { const e=emp(id); return `<span class="avatar ${e?.color || 'blue'} ${extra}">${esc(e?.name?.slice(-1) || '我')}</span>`; };
const badges = {running:['green','运行中'],waiting:['amber','等你决定'],reviewing:['blue','上级评估中'],paused:['muted','已暂停 · 演示'],done:['green','已结束 · 演示']};
const statusBadge = status => `<span class="badge ${badges[status]?.[0] || 'muted'}">${badges[status]?.[1] || esc(status)}</span>`;
const counts = () => ({employees:state.employees.length, teams:state.teams.length, runs:state.runs.length, inbox:pending().length});
function navigate(path) {
  state.drawer=null; state.modal=null; document.body.classList.remove('nav-open');
  if (location.hash === `#/${path}`) render(); else location.hash=`#/${path}`;
}
function route() {
  const parts=(location.hash.replace(/^#\/?/,'') || 'overview').split('/');
  return {page:parts[0],id:parts[1]};
}
function render() {
  const r=route(); const c=counts(); const pages={overview:'概览',employees:'数字员工',teams:'团队与流程',team:'团队与流程',runs:'运行记录',run:'运行记录',inbox:'我的待办',tools:'工具与资料'};
  const active=r.page==='team'?'teams':r.page==='run'?'runs':r.page;
  const nav=[['overview','grid','概览'],['employees','users','数字员工'],['teams','network','团队与流程'],['runs','activity','运行记录'],['inbox','inbox','我的待办'],['tools','tools','工具与资料']];
  document.querySelector('#app').innerHTML=`<div class="shell">
    <aside class="sidebar"><a class="brand" href="#/overview"><span class="brand-mark">g</span><span>Gill<span class="brand-sub">数字员工团队</span></span></a>
      <button class="workspace" data-action="workspace"><span class="avatar blue">我</span><span>我的工作空间</span>${icon('down')}</button>
      <nav class="nav" aria-label="主导航">${nav.map(([page,i,label])=>`<a class="nav-item ${active===page?'active':''}" href="#/${page}"><span class="nav-icon">${icon(i)}</span><span class="nav-label">${label}</span>${page==='inbox'&&c.inbox?`<span class="nav-count">${c.inbox}</span>`:''}</a>`).join('')}</nav>
      <div class="sidebar-bottom"><div class="demo-note">一个人，也能组织一支团队。</div><button class="user" data-action="guide"><span class="avatar blue">我</span><span>团队管理者<small>交互原型 v0.1</small></span>${icon('info')}</button></div></aside>
    <button class="sidebar-scrim" data-action="nav-toggle" aria-label="关闭导航"></button>
    <main class="main"><header class="topbar"><div class="breadcrumbs"><button class="icon-btn mobile-menu" data-action="nav-toggle" aria-label="打开导航">${icon('menu')}</button><span>我的工作空间</span>${icon('chevron')}<b>${pages[r.page]||'概览'}</b></div><div class="top-actions"><span class="prototype-tag">交互原型 · 演示数据</span><button class="icon-btn" data-action="guide" aria-label="演示说明">${icon('info')}</button><button class="icon-btn" data-action="go-inbox" aria-label="我的待办">${icon('inbox')}</button></div></header>
    <div class="content" id="page-content">${renderPage(r)}</div></main></div>`;
  renderOverlay();
}
function renderPage(r) {
  if (r.page==='employees') return renderEmployees();
  if (r.page==='teams') return renderTeams();
  if (r.page==='team') return renderTeam(r.id);
  if (r.page==='runs') return renderRuns();
  if (r.page==='run') return renderRun(r.id);
  if (r.page==='inbox') return renderInbox();
  if (r.page==='tools') return renderTools();
  return renderOverview();
}
function pageHead(eyebrow,title,desc,actions='') {
  return `<div class="page-head"><div><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p class="subtitle">${desc}</p></div><div class="page-actions">${actions}</div></div>`;
}
function runCard(r) {
  const t=team(r.teamId);
  return `<article class="card team-card"><div class="row between"><span class="team-icon ${t.color}">${icon(t.icon)}</span>${statusBadge(r.status)}</div><h3>${esc(r.title)}</h3><p class="muted small">${esc(t.name)} · ${t.members.length} 位员工</p><div class="progress-track"><div class="progress-bar" style="width:${r.progress}%"></div></div><div class="row between"><span class="avatar-stack">${t.members.slice(0,4).map(id=>avatar(id)).join('')}</span><button class="btn ghost small" data-action="open-run" data-id="${r.id}">查看运行 ${icon('arrow')}</button></div></article>`;
}
function decisionRow(d) {
  const desc=d.status==='pending'?(d.type==='proposal'?'员工的调整建议，由你决定':'已逐级评估，需要你的决定'):({resolved:'已记录你的决定',rejected:'你未采纳，配置没有变化',assessing:'上级正在补充依据，问题尚未解决'})[d.status];
  return `<button class="list-row" data-action="decision" data-id="${d.id}"><span class="team-icon ${d.type==='proposal'?'blue':'orange'}">${icon(d.type==='proposal'?'edit':'inbox')}</span><span class="list-main"><span class="list-title">${esc(d.title)}</span><span class="list-desc">${esc(d.from)} · ${desc}</span></span><span class="badge ${d.type==='proposal'?'blue':'amber'}">${d.type==='proposal'?'调整建议':'方案取舍'}</span>${icon('chevron')}</button>`;
}
function renderOverview() {
  return `${pageHead('WORKSPACE / 概览','把目标交给你的数字团队','你定义目标与工作原则，团队自主协作；拿不准的问题逐级向你汇报。',button(`${icon('plus')} 组建团队`,'new-team','secondary'))}
    <section class="hero card"><div class="hero-copy"><span class="badge blue">${icon('spark')} 从一个目标开始</span><h2>今天，想让团队完成什么？</h2><p>可以是研发、业务分析，或你正在面对的任何工作。</p></div><form class="prompt-box" data-form="start-run"><textarea id="goal-input" aria-label="工作目标" placeholder="描述目标、已有资料和你期待的结果。团队会自行规划工作…"></textarea><div class="prompt-foot"><label class="small muted">交给 <select id="goal-team" aria-label="选择团队">${state.teams.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}</select></label><button class="btn primary" type="submit">交给团队 ${icon('arrow')}</button></div><div id="goal-error" class="small" role="alert"></div></form><div class="suggestions"><button class="suggestion" data-action="example" data-kind="biz">${icon('activity')} 分析业务资料</button><button class="suggestion" data-action="example" data-kind="dev">${icon('code')} 改进现有项目</button><button class="suggestion" data-action="example" data-kind="new">${icon('spark')} 从零构建应用</button></div></section>
    <div class="stats"><div class="stat"><span class="stat-label">我的数字员工</span><span class="stat-value">${state.employees.length}<small>位</small></span></div><div class="stat"><span class="stat-label">协作团队</span><span class="stat-value">${state.teams.length}<small>支</small></span></div><div class="stat"><span class="stat-label">进行中的工作</span><span class="stat-value">${state.runs.filter(r=>r.status!=='done').length}<small>项</small></span></div><button class="stat" data-action="go-inbox"><span class="stat-label">需要我的决定 ${icon('arrow')}</span><span class="stat-value" style="color:var(--accent)">${pending().length}<small>项</small></span></button></div>
    <div class="section-title"><h2>正在发生的工作</h2><a class="btn ghost small" href="#/runs">全部运行 ${icon('arrow')}</a></div><div class="grid two">${state.runs.slice(0,2).map(runCard).join('')}</div>
    <div class="section-title"><h2>留给你的关键决定 <span class="badge muted">${pending().length}</span></h2><span class="muted small">团队先评估，你处理最终取舍。</span></div><section class="card list">${pending().slice(0,3).map(decisionRow).join('') || '<div class="empty">暂无需要你决定的事项。</div>'}</section>`;
}
function renderEmployees() {
  const list=state.employees.filter(e=>`${e.name}${e.role}${e.skills.join('')}`.includes(state.employeeFilter));
  return `${pageHead('PEOPLE / 数字员工','你的数字员工','用 Prompt 定义员工的工作方式。职责是分工，不是能力的边界。',button(`${icon('spark')} 生成员工`,'new-employee','primary'))}<div class="row between" style="margin-bottom:18px"><span class="muted small">共 ${state.employees.length} 位员工 · 可在不同团队中复用</span><label class="field" style="margin:0"><input id="employee-search" placeholder="搜索姓名或擅长方向" aria-label="搜索员工" value="${esc(state.employeeFilter)}"></label></div><div class="grid three">${list.map(e=>`<article class="card team-card"><div class="row between">${avatar(e.id)}<span class="badge green">可参与工作</span></div><h3>${esc(e.name)}</h3><p class="muted">${esc(e.role)}</p><div class="chips">${e.skills.map(s=>`<span class="chip">${esc(s)}</span>`).join('')}</div><div class="meta">${e.teamIds.length} 个团队 · 工作 Prompt v${e.version}</div><button class="btn secondary" data-action="employee" data-id="${e.id}">查看员工 ${icon('arrow')}</button></article>`).join('') || '<div class="empty card">没有匹配的员工。换个关键词，或生成一位新员工。</div>'}</div>`;
}
function renderTeams() {
  return `${pageHead('TEAMS / 团队与流程','按你的方式组织团队','描述需要什么团队、如何协作。岗位、人数和流程都可以调整。',button(`${icon('spark')} 用 Prompt 组建团队`,'new-team','primary'))}<div class="grid two">${state.teams.map(t=>`<article class="card team-card"><div class="row between"><span class="team-icon ${t.color}">${icon(t.icon)}</span><span class="badge muted">${t.members.length} 位员工</span></div><h3>${esc(t.name)}</h3><p class="muted">${esc(t.desc)}</p><div class="avatar-stack">${t.members.map(id=>avatar(id)).join('')}</div><div class="meta">我管理 · 流程 Prompt v${t.version}</div><button class="btn secondary" data-action="open-team" data-id="${t.id}">查看团队与流程 ${icon('arrow')}</button></article>`).join('')}</div><div class="notice info" style="margin-top:24px">${icon('info')} 这里的研发和业务团队是两套演示配置。你可以生成其他岗位与团队，不需要选择预设行业。</div>`;
}
function renderOrg(t,parent='user',depth=0) {
  if (depth>12) return '';
  const ids=t.members.filter(id=>t.parents[id]===parent);
  if(!ids.length)return '';
  return `<div class="org-children">${ids.map(id=>`<div class="org-branch"><button class="org-node" data-action="employee" data-id="${id}">${avatar(id)}<span><b>${esc(emp(id).name)}</b><small>${esc(emp(id).role)}</small></span></button>${renderOrg(t,id,depth+1)}</div>`).join('')}</div>`;
}
function renderTeam(id) {
  const t=team(id); if(!t) return notFound();
  const tabs=[['organization','成员与关系'],['flow','流程 Prompt']];
  let body=`<section class="card"><div class="card-head"><div><h3>上下级与汇报路径</h3><p class="muted small">拿不准方案时先向上级评估，最终仍无法解决再反馈给你。</p></div>${button(`${icon('edit')} 编辑关系`,'edit-team','secondary small',`data-id="${t.id}"`)}</div><div class="card-body org-chart"><div class="org-root"><span class="avatar blue">我</span><span><b>我</b><small>最终决定人</small></span></div>${renderOrg(t)}</div><div class="card-body"><div class="notice info">${icon('info')} 该图演示单一直属上级。多上级、异常关系处理仍待确认；监督关系可以与上下级分别配置。</div></div></section><section class="card" style="margin-top:20px"><div class="card-head"><h3>团队的监督协作</h3><span class="badge blue">与上下级分开</span></div><div class="card-body"><p>员工按流程核查彼此产物，提出问题、安排修正并复核。监督者不会因提出意见自动成为对方上级。</p><div class="chips" style="margin-top:16px"><span class="chip">检查具体产物版本</span><span class="chip">保留问题与依据</span><span class="chip">修正后重新核查</span></div></div></section>`;
  if(state.teamTab==='flow') body=`<section class="card"><div class="card-head"><div><h3>让模型理解你的协作原则</h3><p class="muted small">流程定义约定；具体计划由模型结合实际情况调整。</p></div><span class="badge muted">当前 v${t.version}</span></div><form class="card-body prompt-editor" data-form="save-flow" data-id="${t.id}"><label class="field-label" for="flow-prompt">流程 Prompt</label><textarea id="flow-prompt" rows="11">${esc(t.flow)}</textarea><div class="row between" style="margin-top:16px"><span class="muted small">员工可以建议修改，由你决定是否保存。</span><button class="btn primary" type="submit">保存新版本</button></div><p class="demo-note" style="margin-top:16px">原型演示保存配置；对在途运行的生效方式仍待确认。</p></form></section>`;
  return `<button class="breadcrumb-button" data-action="go-teams">${icon('back')} 返回团队</button>${pageHead('TEAM / 团队配置',esc(t.name),esc(t.desc),button(`交给这个团队 ${icon('arrow')}`,'start-team','primary',`data-id="${t.id}"`))}<div class="tabs">${tabs.map(([tab,label])=>`<button class="tab ${state.teamTab===tab?'active':''}" data-action="team-tab" data-tab="${tab}">${label}</button>`).join('')}</div>${body}`;
}
function renderRuns() {
  return `${pageHead('WORK / 运行记录','查看团队正在做什么','从目标、动态安排到实际产物，保留每一步协作和决定。',button(`${icon('plus')} 发起工作`,'go-overview','primary'))}<div class="grid two">${state.runs.map(runCard).join('')}</div>`;
}
function renderInbox() {
  const list=state.decisions.filter(d=>state.inboxFilter==='pending'?d.status==='pending':d.status!=='pending');
  const empty=`<div class="empty">${icon('check')}<h3>这里暂时没有待办</h3><p>团队继续工作，需要你的时候会带着依据来找你。</p></div>`;
  return `${pageHead('DECISIONS / 我的待办','把注意力留给关键决定','上级先处理团队内的问题；仍无法确定的方案和员工调整建议会汇总到这里。')}<div class="tabs"><button class="tab ${state.inboxFilter==='pending'?'active':''}" data-action="inbox-tab" data-tab="pending">待我决定 <span class="badge amber">${pending().length}</span></button><button class="tab ${state.inboxFilter==='resolved'?'active':''}" data-action="inbox-tab" data-tab="resolved">已处理</button></div><section class="card list">${list.map(decisionRow).join('')||empty}</section><div class="notice info" style="margin-top:20px">${icon('info')} 发起任务、调整执行计划由团队自主完成。新增员工和长期 Prompt 调整，由你决定。</div>`;
}
function renderTools() {
  return `${pageHead('RESOURCES / 工具与资料','让团队用好已有能力','工具与资料可供不同岗位使用，员工可以选择和组合方法。',button(`${icon('plus')} 添加连接`,'add-tool','primary'))}<div class="grid two">${state.tools.map(t=>`<article class="card team-card"><div class="row between"><span class="team-icon blue">${icon(t.icon)}</span><span class="badge ${t.state==='示例可用'?'green':'amber'}">${esc(t.state)}</span></div><h3>${esc(t.name)}</h3><p class="muted">${esc(t.desc)}</p><button class="btn secondary" data-action="tool-detail" data-name="${esc(t.name)}">查看连接 ${icon('arrow')}</button></article>`).join('')}</div><section class="card" style="margin-top:24px"><div class="card-head"><h3>工作资料</h3><span class="badge muted">合成示例</span></div><button class="list-row" data-action="artifact" data-id="source">${icon('file')}<span class="list-main"><span class="list-title">本周商机资料 · 示例</span><span class="list-desc">业务洞察团队 · 用于运行演示</span></span>${icon('chevron')}</button></section>`;
}
function notFound() { return '<div class="empty card"><h2>没有找到这项内容</h2><a class="btn primary" href="#/overview">返回概览</a></div>'; }

function renderRun(id) {
  const r=run(id); if(!r) return notFound(); const t=team(r.teamId);
  const waiting=state.decisions.find(d=>d.runId===id&&d.type==='escalation'&&d.status==='pending');
  const tabs=[['activity','协作动态'],['tasks','当前安排'],['artifacts','产物与核查'],['messages','员工沟通']];
  let content=`<section class="card"><div class="card-head"><h3>团队正在怎样推进</h3>${button('演示下一个事件','advance','ghost small',`data-id="${id}"`)}</div><div class="activity">${r.activities.map(([actor,text,time])=>`<div class="activity-item"><div class="activity-avatar">${avatar(actor)}</div><div class="activity-content"><b>${actor==='user'?'我':esc(emp(actor)?.name||'团队')}</b><p>${esc(text)}</p></div><span class="activity-time">${time}</span></div>`).join('')}</div></section>`;
  if(state.runTab==='tasks') content=`<section class="card"><div class="card-head"><div><h3>当前安排</h3><p class="muted small">由团队根据目标和反馈动态调整，不是固定业务阶段。</p></div>${button('演示重规划','replan','secondary small',`data-id="${id}"`)}</div><div class="task-list">${r.tasks.map(([name,owner,status])=>`<div class="task-row"><span class="dot ${status==='done'?'green':status==='waiting'?'amber':'blue'}"></span><span class="list-main"><b>${esc(name)}</b><span class="list-desc">${esc(owner)}</span></span><span class="badge ${status==='done'?'green':status==='waiting'?'amber':status==='running'?'blue':'muted'}">${({done:'已完成 · 示例',waiting:'等待决定',running:'进行中',pending:'待安排'})[status]||'待安排'}</span></div>`).join('')}</div><div class="card-body"><div class="notice info">${icon('info')} 这里演示任务的等待状态。升级时的等待范围、其他任务如何继续，仍待产品确认。</div></div></section>`;
  if(state.runTab==='artifacts') content=renderArtifacts(r);
  if(state.runTab==='messages') content=renderMessages(r,t);
  return `<button class="breadcrumb-button" data-action="go-runs">${icon('back')} 返回运行记录</button>${pageHead('RUN / 团队工作',esc(r.title),`${esc(t.name)} · ${t.members.length} 位员工 · 流程版本 v${r.version}`,`${statusBadge(r.status)}${button(`${icon(r.status==='paused'?'play':'pause')} ${r.status==='paused'?'继续演示':'暂停演示'}`,'toggle-pause','secondary',`data-id="${id}"`)}`)}<section class="card" style="margin-bottom:24px"><div class="card-body"><div class="eyebrow">本次目标</div><p>${esc(r.goal)}</p></div></section><div class="run-layout"><div class="run-main"><div class="tabs">${tabs.map(([tab,label])=>`<button class="tab ${state.runTab===tab?'active':''}" data-action="run-tab" data-tab="${tab}">${label}</button>`).join('')}</div>${r.status==='paused'?'<div class="notice amber" style="margin-bottom:16px">暂停状态为交互演示。在途动作的实际停止反馈与等待范围，后续需进一步确定。</div>':''}${content}</div><aside class="run-side">${waiting?`<section class="card decision-card"><div class="card-body"><span class="badge amber">${icon('inbox')} 需要你决定</span><h3 style="margin:14px 0 8px">${esc(waiting.title)}</h3><p class="muted small">员工已提交上级评估。上级仍缺少依据，带着方案来找你。</p><button class="btn primary" style="margin-top:16px;width:100%" data-action="decision" data-id="${waiting.id}">查看评估与方案 ${icon('arrow')}</button></div></section>`:''}<section class="card"><div class="card-head"><h3>参与的员工</h3></div><div class="card-body stack">${t.members.map(e=>`<button class="row btn ghost" style="justify-content:flex-start" data-action="employee" data-id="${e}">${avatar(e)}<span>${esc(emp(e).name)}<small class="muted" style="display:block">${esc(emp(e).role)}</small></span></button>`).join('')}<button class="btn secondary" data-action="open-team" data-id="${t.id}">查看团队与汇报关系</button></div></section><div class="demo-note" style="margin-top:16px">本页的工作、消息与结果均为合成演示。没有调用真实模型或执行工具。</div></aside></div>`;
}
function renderArtifacts(r) {
  const biz=r.id==='biz-run';const dev=r.id==='dev-run';
  if(!biz&&!dev)return '<section class="card empty"><h3>这个运行还没有产物</h3><p>团队提交成果后，会在这里关联产物版本、检查依据与问题。本次新运行不沿用其他工作的示例产物。</p></section>';
  return `<section class="card"><div class="card-head"><h3>工作产物与核查</h3><span class="badge muted">属于本次运行的示例内容</span></div><button class="list-row" data-action="artifact" data-id="${biz?'report-v2':'dev-report'}">${icon('file')}<span class="list-main"><span class="list-title">${biz?'商机分析简报 · v2':'搜索交互变更说明 · v1'}</span><span class="list-desc">${biz?'已关联复核记录与数据口径':'已记录当前方案与预期核查范围'}</span></span><span class="badge ${biz?'green':'blue'}">${biz?'已复核 · 示例':'待核查'}</span>${icon('chevron')}</button>${biz?'<button class="list-row" data-action="artifact" data-id="report-v1"><span class="list-main"><span class="list-title">商机分析简报 · v1</span><span class="list-desc">保留原始问题：关键指标分母口径不一致</span></span><span class="badge amber">需修正 · 历史</span></button>':''}<button class="list-row" data-action="artifact" data-id="${biz?'biz-verification':'dev-verification'}"><span class="list-main"><span class="list-title">${biz?'独立核查记录':'预期核查范围 · 尚未执行'}</span><span class="list-desc">${biz?'检查对象、版本、发现的问题与后续复核':'对应搜索交互变更说明 v1；不借用其他运行的结果'}</span></span>${icon('chevron')}</button></section>`;
}
function renderMessages(r,t) {
  const worker=t.members[1]||t.members[0];const reviewer=t.members.at(-1);
  return `<section class="card"><div class="card-head"><h3>员工之间的沟通</h3><span class="badge muted">演示记录</span></div><div class="activity"><div class="activity-item">${avatar(reviewer)}<div class="activity-content"><b>${esc(emp(reviewer).name)} → ${esc(emp(worker).name)}</b><p>请补充关键结论的依据，并关联到当前产物版本。已有意见不会自动覆盖新版内容。</p></div></div><div class="activity-item">${avatar(worker)}<div class="activity-content"><b>${esc(emp(worker).name)} → 团队</b><p>已收到，我会补充依据后提交复核。当前方案的取舍问题已按层级反馈。</p></div></div>${(r.messages||[]).map(text=>`<div class="activity-item">${avatar('user')}<div class="activity-content"><b>我 → 团队</b><p>${esc(text)}</p></div></div>`).join('')}</div><form class="card-body" data-form="run-message" data-id="${r.id}"><label class="field-label" for="run-message">补充给团队的指令</label><textarea class="input" id="run-message" placeholder="补充目标、上下文，或让团队继续核查…"></textarea><div class="row between" style="margin-top:12px"><span class="small muted">团队会据此调整工作安排。</span><button class="btn primary" type="submit">发送给团队</button></div></form></section>`;
}
function openDrawer(type,id,extra={}) { state.modal=null; state.drawer={type,id,...extra}; renderOverlay(); }
function openModal(type,extra={}) { state.drawer=null; state.modal={type,...extra}; renderOverlay(); }
function closeOverlay() { state.drawer=null;state.modal=null;state.generationToken++;renderOverlay(); }
function renderOverlay() {
  const overlay=state.drawer||state.modal; const host=document.querySelector('#overlays');
  document.body.classList.toggle('drawer-open',Boolean(overlay));
  if(!overlay) { host.innerHTML='';return; }
  const parts=state.drawer?drawerParts(overlay):modalParts(overlay);
  host.innerHTML=`<div class="overlay" data-backdrop="true"><section class="${state.drawer?'drawer':'modal'}" role="dialog" aria-modal="true" aria-labelledby="overlay-title" tabindex="-1"><div class="drawer-head"><div><span class="eyebrow">${parts.kicker||'交互演示'}</span><h2 id="overlay-title">${parts.title}</h2></div><button class="icon-btn" data-action="close-overlay" aria-label="关闭面板">${icon('close')}</button></div><div class="drawer-body">${parts.body}</div>${parts.foot?`<div class="drawer-foot">${parts.foot}</div>`:''}</section></div>`;
}
function drawerParts(d) {
  if(d.type==='employee') return employeeDrawer(d);
  if(d.type==='decision') return decisionDrawer(d);
  if(d.type==='artifact') return artifactDrawer(d.id);
  if(d.type==='tool') return {kicker:'工具连接 · 示例',title:esc(d.id),body:'<div class="notice info">这是工具与能力入口的交互示例，没有建立真实连接。</div><div class="definition-block"><h3>团队如何使用</h3><p>不同岗位都能发现和组合可用工具。员工可以自行选择工作方法；真实可用性以连接与执行结果为准。</p></div>',foot:button('关闭','close-overlay')};
  return {title:'详情',body:'',foot:button('关闭','close-overlay')};
}
function employeeDrawer(d) {
  const e=emp(d.id); if(!e) return {title:'员工不存在',body:'请返回员工列表。'};
  return {kicker:`数字员工 · 工作 Prompt v${e.version}`,title:esc(e.name),body:`<div class="row">${avatar(e.id)}<div><h3>${esc(e.role)}</h3><p class="muted small">${e.teamIds.length} 个团队 · 由你管理工作方式</p></div></div><div class="chips" style="margin-top:18px">${e.skills.map(s=>`<span class="chip">${esc(s)}</span>`).join('')}</div><p class="demo-note" style="margin-top:12px">擅长方向用于分工，不限制员工使用可用工具或协助其他工作。</p>${d.edit?`<div class="field" style="margin-top:24px"><label class="field-label" for="employee-work-prompt">修改工作 Prompt</label><textarea class="input" id="employee-work-prompt" rows="13">${esc(e.prompt)}</textarea></div><p class="demo-note">本次演示保存员工配置。对在途运行的生效方式仍待确认。</p>`:`<div class="definition-block"><h3>工作 Prompt</h3><pre>${esc(e.prompt)}</pre></div><div class="definition-block"><h3>参与团队</h3>${e.teamIds.map(id=>`<button class="btn ghost small" data-action="open-team" data-id="${id}">${esc(team(id)?.name||id)} ${icon('arrow')}</button>`).join('')||'<p class="muted">尚未加入团队，可在团队配置时使用。</p>'}</div>`}`,foot:d.edit?`${button('取消编辑','employee-cancel-edit')}${button('保存新版本','save-employee','primary',`data-id="${e.id}"`)}`:`${button('关闭','close-overlay')}${button(`${icon('edit')} 修改 Prompt`,'employee-edit','primary')}`};
}
function decisionDrawer(d) {
  const item=state.decisions.find(i=>i.id===d.id); if(!item)return {title:'事项不存在',body:''};
  if(item.type==='proposal')return proposalDrawer(item);
  const resolved=item.status!=='pending';
  return {kicker:'逐级上报 · 方案取舍',title:esc(item.title),body:`<div class="notice amber">${item.status==='resolved'?'你已经提交决定；团队将依据决定继续工作。':item.status==='assessing'?'已要求上级补充依据，这项问题仍未解决。':'资料同时提到“近期成交”和“长期潜力”，缺少明确优先级。团队需要知道这次如何取舍。'}</div><div class="definition-block"><h3>问题来自哪项工作</h3><p>${esc(run(item.runId)?.title||'团队工作')}</p></div><h3 style="margin:24px 0 12px">上报与评估经过</h3><div class="timeline">${escalationStep('江禾','提出不确定问题','现有资料无法同时满足两种优先级，提交上级评估。','09:52')}${escalationStep('林岚','上级评估后仍缺少依据','已比较两个方案，缺少你的业务侧重点，向你反馈。','09:56')}${escalationStep('我','最终决定人',resolved?(item.answer||'已要求上级补充核查依据；等待新的评估。'):'当前等你决定；未回复不会被当作同意。',resolved?'刚刚':'待决定')}</div>${resolved?`<div class="definition-block"><h3>处理结果</h3><p>${esc(item.answer||'已转交上级补充依据，尚未解决。')}</p></div>`:`<h3 style="margin:22px 0 10px">团队整理的两个方案</h3><button class="btn secondary" style="white-space:normal;width:100%;justify-content:flex-start;margin-bottom:8px" data-action="decision-option" data-value="优先近期成交：先跟进需求明确、近期可推进的机会，长期潜力单独列为观察项。">A · 优先近期成交，先形成可推进的行动</button><button class="btn secondary" style="white-space:normal;width:100%;justify-content:flex-start" data-action="decision-option" data-value="优先长期潜力：关注匹配度与长期合作空间，近期成交不作为唯一排序依据。">B · 优先长期潜力，关注匹配与合作空间</button><div class="field" style="margin-top:20px"><label class="field-label" for="decision-answer">你的决定或补充说明</label><textarea class="input" id="decision-answer" placeholder="可以选择上面的方案，也可以写下自己的判断…">${esc(d.answer||'')}</textarea><div id="decision-error" class="small" role="alert"></div></div>`}<p class="demo-note">上报、评估和提交结果均为合成演示；等待范围和恢复方式仍待确认。</p>`,foot:resolved?button('关闭','close-overlay'):`${button('要求补充依据','request-evidence','secondary',`data-id="${item.id}"`)}${button('提交决定','submit-decision','primary',`data-id="${item.id}"`)}`};
}
function escalationStep(who,label,desc,time) { return `<div class="timeline-item"><div class="row between"><b>${who} · ${label}</b><span class="muted small">${time}</span></div><p class="muted small">${esc(desc)}</p></div>`; }
function proposalDrawer(item) {
  const e=emp(item.employeeId); const addition='\n核查关键指标时，逐项记录分母口径、资料来源与适用版本；发现缺口时保留问题并提交复核。';
  const done=item.status!=='pending';
  return {kicker:'员工建议 · 由你决定',title:esc(item.title),body:`<div class="row">${avatar(e.id)}<div><b>${esc(e.name)} 提出的建议</b><p class="muted small">${done?'这项建议已经处理':'尚未修改员工的工作 Prompt'}</p></div></div><div class="definition-block"><h3>为什么提出</h3><p>本次核查发现指标口径容易遗漏。建议把检查方法补充到长期工作指令，供后续任务参考。</p></div><div class="definition-block"><h3>当前版本 v${e.version}</h3><pre>${esc(e.prompt)}</pre></div>${done?`<div class="notice info" style="margin-top:16px">${item.status==='resolved'?'你已采纳并保存为新的员工版本。':'你未采纳此建议，员工配置没有因此变化。'}</div>`:`<div class="field" style="margin-top:20px"><label class="field-label" for="proposal-prompt">建议后的工作 Prompt · 你可以继续修改</label><textarea class="input" id="proposal-prompt" rows="9">${esc(e.prompt+addition)}</textarea></div>`}<p class="demo-note">这里只演示保存员工配置；在途运行采用新版本的方式仍待确定。</p>`,foot:done?button('关闭','close-overlay'):`${button('不采纳','reject-proposal','secondary',`data-id="${item.id}"`)}${button('采纳并保存','apply-proposal','primary',`data-id="${item.id}"`)}`};
}
function artifactDrawer(id) {
  const data={
    source:['本周商机资料 · 示例','原始资料','12 条合成商机，覆盖需求明确度、近期推进可能性和长期合作潜力。所有名称与数据仅用于演示。'],
    'report-v2':['商机分析简报 · v2','复核后的示例产物','本周可重点跟进 4 条示例机会。\n1. 统一采用有效询盘作为分母。\n2. 分别列出近期推进机会与长期潜力机会。\n3. 最终优先顺序等待管理者的取舍依据。'],
    'report-v1':['商机分析简报 · v1','历史版本 · 需要修正','初稿将“总询盘”和“有效询盘”混用为分母。周予提出问题 Q-02，原始检查失败记录保留；后续 v2 修正不覆盖此版本的历史事实。'],
    'dev-report':['搜索交互变更说明 · v1','待核查的示例产物','计划完善搜索词保留、空结果引导和键盘访问。当前为演示产物；没有实际代码变更或测试结果。'],
    'biz-verification':['独立核查记录','商机跟进运行 · 对应产物 v2','检查对象：商机分析简报 v2\n检查人：周予\n示例结果：8 项关键数据核对完成\n历史问题：Q-02 分母口径不一致\n修正引用：分析简报 v2\n未决事项：跟进优先级仍待管理者决定。'],
    'dev-verification':['搜索交互预期核查范围','搜索体验运行 · 尚未执行','检查对象：搜索交互变更说明 v1\n预期核查：搜索词保留、空结果引导、键盘访问与变更影响。\n当前状态：尚未执行真实核查。\n本记录不引用商机分析运行中的数据或检查结果。'],
  }[id]||['工作产物','演示内容','这是本地合成交付物，用于确认产物详情的查看体验。'];
  return {kicker:data[1],title:data[0],body:`<div class="notice info">${icon('file')} 合成示例内容，用于评审查看和追溯体验。</div><div class="artifact-preview definition-block"><h3>${data[0]}</h3><pre>${esc(data[2])}</pre></div><div class="definition-block"><h3>追溯关系</h3><p class="small muted">工作目标 → 产物版本 → 检查问题 → 修正与复核。不同版本的结论分别保留。</p></div>`,foot:button('关闭','close-overlay')};
}

function modalParts(m) {
  if(m.type==='generate')return generationModal(m);
  if(m.type==='edit-team')return editTeamModal(m);
  if(m.type==='add-tool')return {kicker:'工具与资料 · 演示',title:'添加一个连接',body:'<form data-form="add-tool" id="add-tool-form"><div class="field"><label class="field-label" for="tool-name">连接名称</label><input class="input" id="tool-name" placeholder="例如：内部知识资料"></div><div class="field"><label class="field-label" for="tool-desc">描述它能帮助团队做什么</label><textarea class="input" id="tool-desc" placeholder="说明用途、已有资料或需要接入的能力…"></textarea></div><p class="demo-note">仅添加一个未验证的示例连接，不访问真实地址或系统。</p></form>',foot:`${button('取消','close-overlay')}<button class="btn primary" form="add-tool-form" type="submit">保存示例连接</button>`};
  if(m.type==='workspace')return {kicker:'当前空间',title:'我的工作空间',body:'<p>在这里生成员工、组织团队并管理工作。当前原型仅展示一个管理者的工作空间。</p><div class="definition-block"><h3>管理者掌握什么</h3><p>目标、员工与长期 Prompt 的调整，以及团队逐级提交的最终取舍。</p></div>',foot:button('知道了','close-overlay','primary')};
  return {kicker:'交互原型 v0.1',title:'先体验这三条路径',body:'<div class="definition-block"><h3>01 · 从描述到数字团队</h3><p>打开「数字员工」或「团队与流程」，输入 Prompt，查看和修改草案后采用。</p></div><div class="definition-block"><h3>02 · 给团队目标，看它怎样推进</h3><p>在概览发起工作，查看协作动态、当前安排、员工沟通、产物与核查。可点击「演示下一个事件」。</p></div><div class="definition-block"><h3>03 · 只处理需要你决定的事</h3><p>打开「我的待办」，查看上报经过并提交决定，或采纳/拒绝员工的 Prompt 调整建议。</p></div><div class="notice info" style="margin-top:18px">所有数据、生成内容、运行和提交均为本地演示；刷新会重置。本原型未接入模型或真实业务系统。层级形式、等待范围和在途版本生效方式仍待确认。</div>',foot:`${button('重置演示','reset','secondary')}${button('开始体验','close-overlay','primary')}`};
}
function generationModal(m) {
  const isTeam=m.kind==='team'; const label=isTeam?'团队':'员工';
  if(m.step==='loading')return {kicker:'本地生成演示',title:`正在整理${label}草案`,body:'<div class="generation-card"><div class="generation-step done">✓ 保留你的原始要求</div><div class="generation-step active">正在整理职责、协作和工作方式…</div><p class="demo-note">这里用预置内容模拟生成过程，不会调用真实模型。</p></div>'};
  if(m.step==='ready')return {kicker:'生成结果 · 可继续调整',title:`查看${label}草案`,body:`<div class="notice info">预置生成示例，供你确认操作方式。你的输入会保留在工作指令中，真实内容由后续模型能力生成。</div>${isTeam?`<div class="field" style="margin-top:20px"><label class="field-label" for="draft-team-name">团队名称</label><input class="input" id="draft-team-name" value="${esc(m.name)}"></div>`:''}<div class="definition-block"><h3>你的原始描述</h3><p class="small muted">${esc(m.prompt)}</p></div>${m.candidates.map((c,i)=>`<div class="generation-card" style="margin-top:18px;padding:16px;border:1px solid var(--line);border-radius:10px"><div class="row between"><span class="badge blue">员工草案 ${i+1}</span>${isTeam?button('移除','remove-candidate','ghost small',`data-index="${i}"`):''}</div><div class="field" style="margin-top:12px"><label class="field-label">员工名称</label><input class="input" aria-label="员工名称 ${i+1}" data-draft-index="${i}" data-draft-key="name" value="${esc(c.name)}"></div><div class="field"><label class="field-label">当前主要分工</label><input class="input" aria-label="员工分工 ${i+1}" data-draft-index="${i}" data-draft-key="role" value="${esc(c.role)}"></div><details><summary class="small" style="cursor:pointer;color:var(--blue)">查看与修改工作 Prompt</summary><textarea class="input" rows="7" style="margin-top:10px" aria-label="员工工作 Prompt ${i+1}" data-draft-index="${i}" data-draft-key="prompt">${esc(c.prompt)}</textarea></details></div>`).join('')}${isTeam?`<div style="margin-top:15px">${button(`${icon('plus')} 添加一位员工草案`,'add-candidate','secondary')}</div><p class="demo-note" style="margin-top:12px">本次示例先将第一位员工作为直属负责人，其他成员向其汇报；采用后可以编辑关系。这是层级演示，不是固定岗位或人数限制。</p>`:''}`,foot:`${button('返回修改描述','generation-back')}${button(isTeam?'采用员工并创建团队':'保存员工','accept-generation','primary')}`};
  return {kicker:'PROMPT / 自然语言定义',title:isTeam?'描述你需要的团队':'描述你需要的数字员工',body:`<form data-form="generate" id="generate-form"><div class="field"><label class="field-label" for="generation-prompt">${isTeam?'想完成什么工作？团队如何协作？':'希望这位员工负责什么、怎样工作？'}</label><textarea class="input" id="generation-prompt" rows="8" placeholder="${isTeam?'例如：组建一个市场研究团队，帮助我整理资料、提出判断并交叉核查。有不确定的问题逐级上报。':'例如：我需要一位客户洞察顾问，能分析资料、主动追问依据、与其他员工交叉核查。'}">${esc(m.prompt||'')}</textarea><div id="generation-error" class="small" role="alert"></div></div><div class="chips"><span class="chip">岗位自定义</span><span class="chip">工作方式由 Prompt 描述</span><span class="chip">不绑定研发场景</span></div><p class="demo-note" style="margin-top:18px">原型展示生成、调整和采用的操作流程，生成结果为预置示例。</p></form>`,foot:`${button('取消','close-overlay')}<button class="btn primary" form="generate-form" type="submit">${icon('spark')} 生成${label}草案</button>`};
}
function editTeamModal(m) {
  const t=team(m.id);
  return {kicker:'组织关系 · 用户配置',title:`编辑${esc(t.name)}`,body:`<form id="edit-team-form" data-form="edit-team" data-id="${t.id}"><div class="field"><label class="field-label" for="team-name">团队名称</label><input class="input" id="team-name" value="${esc(t.name)}"></div><p class="muted small" style="margin-bottom:18px">本次原型演示单一直属上级。岗位名称不自动决定层级；多上级形式仍待确认。</p>${t.members.map(id=>`<div class="field"><label class="field-label" for="parent-${id}">${esc(emp(id).name)} 的上级</label><select class="select" id="parent-${id}"><option value="user" ${t.parents[id]==='user'?'selected':''}>我 · 最终决定人</option>${t.members.filter(other=>other!==id).map(other=>`<option value="${other}" ${t.parents[id]===other?'selected':''}>${esc(emp(other).name)}</option>`).join('')}</select></div>`).join('')}<div id="team-error" class="small" role="alert"></div></form>`,foot:`${button('取消','close-overlay')}<button class="btn primary" form="edit-team-form" type="submit">保存关系</button>`};
}
function toast(message) {
  const el=document.querySelector('#toast');clearTimeout(state.toastTimer);
  el.innerHTML=`${icon('check')}<span>${esc(message)}</span>`;el.hidden=false;
  state.toastTimer=setTimeout(()=>{el.hidden=true;},3200);
}
function showError(id,message) {
  const el=document.getElementById(id); if(el){el.textContent=message;el.style.color='var(--red)';el.style.marginTop='8px';}else toast(message);
}
function generateCandidates(prompt,kind) {
  const base=`用户描述：${prompt}\n\n结合目标自主选择方法与可用工具；保留依据，主动协作。职责不构成能力限制。拿不准时向直属上级提交评估；长期指令调整只向用户提出建议。`;
  if(kind==='employee')return [{name:'新同事',role:prompt.includes('顾问')?'洞察顾问':'自定义工作职责',prompt:base}];
  return [{name:'协作负责人',role:'目标澄清与团队协调',prompt:base},{name:'执行伙伴',role:'根据目标自主开展工作',prompt:base},{name:'核查伙伴',role:'检查依据、提出问题并复核',prompt:base}];
}
function beginGeneration() {
  const prompt=document.querySelector('#generation-prompt').value.trim();
  if(!prompt)return showError('generation-error','先描述一下你需要什么员工或团队。');
  const m=state.modal;const token=++state.generationToken;m.prompt=prompt;m.step='loading';renderOverlay();
  setTimeout(()=>{if(state.modal!==m||token!==state.generationToken)return;m.step='ready';m.candidates=generateCandidates(prompt,m.kind);m.name=prompt.includes('研发')?'新的研发团队':'新的协作团队';renderOverlay();},650);
}
function acceptGeneration() {
  const m=state.modal;if(!m||!m.candidates?.length)return toast('至少保留一位员工草案。');
  if(m.candidates.some(c=>!c.name.trim()||!c.prompt.trim()))return toast('请补充员工名称和工作 Prompt。');
  const prefix=String(Date.now());const teamId=`team-${prefix}`;const ids=[];
  m.candidates.forEach((c,i)=>{const e=employee(`employee-${prefix}-${i}`,c.name,c.role,['blue','violet','orange','green'][i%4],['自主协作','开放任务'],m.kind==='team'?[teamId]:[]);e.prompt=c.prompt;ids.push(e.id);state.employees.push(e);});
  if(m.kind==='team') {
    const name=document.querySelector('#draft-team-name').value.trim()||'新的协作团队';
    const parents=Object.fromEntries(ids.map((id,i)=>[id,i===0?'user':ids[0]]));
    state.teams.push({id:teamId,name,desc:m.prompt,icon:'network',color:'blue',members:ids,parents,version:1,flow:`团队与协作要求：\n${m.prompt}\n\n${defaultFlow}`});
    state.teamTab='organization';navigate(`team/${teamId}`);toast('员工与团队已按你的选择创建 · 本地演示');
  } else {navigate('employees');toast('员工已保存 · 本地演示');}
}
function startRun() {
  const input=document.querySelector('#goal-input');const goal=input.value.trim();
  if(!goal)return showError('goal-error','先写下一个工作目标，或选择下方的示例。');
  const t=team(document.querySelector('#goal-team').value);const id=`run-${Date.now()}`;const worker=t.members[1]||t.members[0];
  state.runs.unshift({id,teamId:t.id,title:goal.length>26?`${goal.slice(0,26)}…`:goal,goal,status:'running',progress:12,version:t.version,tasks:[['理解目标与已有资料',emp(t.members[0]).name,'done'],['根据目标安排工作',emp(worker).name,'running'],['核查关键结果','由团队动态安排','pending']],activities:[[t.members[0],'已接到目标，开始整理上下文与分工。','刚刚'],[worker,'已建立初步任务安排，后续根据实际反馈调整。','刚刚']]});
  state.runTab='activity';navigate(`run/${id}`);toast('已进入团队工作的演示状态，没有调用真实模型');
}
function submitDecision(id) {
  const item=state.decisions.find(d=>d.id===id);const answer=document.querySelector('#decision-answer').value.trim();
  if(!answer)return showError('decision-error','请明确写下你的决定，或选择一个方案后补充说明。');
  item.status='resolved';item.answer=answer;const r=run(item.runId);const paused=r.status==='paused';
  if(paused)r.beforePause='running';else r.status='running';r.progress=Math.max(r.progress,70);
  r.activities.push(['user',`已提交决定：${answer}`,'刚刚']);
  if(!paused)r.activities.push([team(r.teamId).members[0],'已收到你的决定，将据此调整后续安排。','刚刚']);
  r.tasks=r.tasks.map(t=>t[2]==='waiting'?[t[0],t[1],'done']:t);state.drawer=null;render();toast(paused?'决定已记录，运行仍保持暂停 · 演示':'决定已记录，团队继续工作的状态已更新 · 演示');
}
function applyProposal(id) {
  const d=state.decisions.find(i=>i.id===id);const value=document.querySelector('#proposal-prompt').value.trim();
  if(!value)return toast('请保留有效的工作 Prompt。');
  const e=emp(d.employeeId);e.prompt=value;e.version++;d.status='resolved';state.drawer=null;render();toast(`你已采纳建议并保存员工版本 v${e.version} · 演示`);
}
function requestEvidence(id) {
  const d=state.decisions.find(i=>i.id===id);d.status='assessing';d.answer='用户要求补充取舍依据；问题尚未解决，已交上级继续评估。';
  const r=run(d.runId);if(r.status==='paused')r.beforePause='reviewing';else r.status='reviewing';r.activities.push(['user','要求上级继续补充依据，尚未作出方案取舍。','刚刚']);state.drawer=null;render();toast('已记录补充依据请求，问题仍未解决；已暂停的运行保持暂停');
}
function advanceRun(id) {
  const r=run(id);if(r.status==='paused')return toast('先继续演示，再查看后续事件。');
  const d=state.decisions.find(i=>i.runId===id&&i.type==='escalation');
  if(d?.status==='pending'){openDrawer('decision',d.id);return;}
  if(d?.status==='assessing'){d.status='pending';d.answer='';r.status='waiting';r.activities.push([team(r.teamId).members[0],'已补充两个方案的依据，仍需你明确取舍，再次提交给你。','刚刚']);}
  else {r.activities.push([team(r.teamId).members.at(-1),'已检查当前工作的依据，整理了需要继续核查的内容。','刚刚']);r.progress=Math.min(r.progress+8,86);}
  render();toast('已追加一个协作事件 · 合成演示');
}

function saveEmployee(id) {
  const text=document.querySelector('#employee-work-prompt').value.trim();if(!text)return toast('请保留有效的工作 Prompt。');
  const e=emp(id);e.prompt=text;e.version++;state.drawer.edit=false;render();toast(`工作 Prompt v${e.version} 已保存 · 演示`);
}
function replan(id) {
  const r=run(id);const t=team(r.teamId);
  if(r.status==='paused')return toast('先继续演示，再调整当前安排。');
  if(!r.tasks.some(row=>row[0]==='补充当前结论的依据'))r.tasks.splice(1,0,['补充当前结论的依据',emp(t.members.at(-1)).name,'running']);
  r.activities.push([t.members[0],'根据核查反馈补充一项任务，长期流程 Prompt 没有因此改变。','刚刚']);render();toast('已演示动态重规划；没有新增员工或改写长期规则');
}
function saveTeam(id) {
  const t=team(id);const parents=Object.fromEntries(t.members.map(e=>[e,document.querySelector(`#parent-${e}`).value]));
  for(const id of t.members) {
    let current=id;const visited=new Set();
    while(current!=='user') {if(visited.has(current))return showError('team-error','当前关系形成了循环，请调整后再保存。');visited.add(current);current=parents[current]||'user';}
  }
  t.name=document.querySelector('#team-name').value.trim()||t.name;t.parents=parents;t.orgVersion=(t.orgVersion||1)+1;state.modal=null;render();toast('团队关系已按你的操作保存 · 演示');
}
function sendRunMessage(id) {
  const text=document.querySelector('#run-message').value.trim();if(!text)return toast('先写下要补充给团队的内容。');
  const r=run(id);r.messages||=[];r.messages.push(text);r.activities.push(['user',text,'刚刚']);render();toast('补充指令已记录在演示中');
}
function selectExample(kind) {
  const values={biz:['根据本周商机资料整理跟进建议，核对关键数据；遇到取舍先交上级评估。','biz'],dev:['改进现有工作台的搜索体验，自主安排分析、实现与核查，并说明变更依据。','dev'],new:['从零设计一个轻量的预约应用，先澄清目标，自主拆解和验证可用成果。','dev']};
  const [value,id]=values[kind];document.querySelector('#goal-input').value=value;document.querySelector('#goal-team').value=id;document.querySelector('#goal-input').focus();
}
const actions = {
  'nav-toggle':()=>document.body.classList.toggle('nav-open'),
  'go-overview':()=>navigate('overview'), 'go-teams':()=>navigate('teams'), 'go-runs':()=>navigate('runs'), 'go-inbox':()=>navigate('inbox'),
  workspace:()=>openModal('workspace'),guide:()=>openModal('guide'), 'close-overlay':closeOverlay,
  'new-employee':()=>openModal('generate',{kind:'employee',step:'input',prompt:''}),
  'new-team':()=>openModal('generate',{kind:'team',step:'input',prompt:''}),
  'open-team':b=>{state.teamTab='organization';navigate(`team/${b.dataset.id}`);},
  'open-run':b=>{state.runTab='activity';navigate(`run/${b.dataset.id}`);},
  employee:b=>openDrawer('employee',b.dataset.id),artifact:b=>openDrawer('artifact',b.dataset.id),decision:b=>openDrawer('decision',b.dataset.id),
  'employee-edit':()=>{state.drawer.edit=true;renderOverlay();},'employee-cancel-edit':()=>{state.drawer.edit=false;renderOverlay();},
  'save-employee':b=>saveEmployee(b.dataset.id),
  'team-tab':b=>{state.teamTab=b.dataset.tab;render();},'run-tab':b=>{state.runTab=b.dataset.tab;render();},
  'inbox-tab':b=>{state.inboxFilter=b.dataset.tab;render();},
  'edit-team':b=>openModal('edit-team',{id:b.dataset.id}),
  'start-team':b=>{const id=b.dataset.id;navigate('overview');setTimeout(()=>{document.querySelector('#goal-team').value=id;document.querySelector('#goal-input').focus();},50);},
  example:b=>selectExample(b.dataset.kind),
  'decision-option':b=>{state.drawer.answer=b.dataset.value;document.querySelector('#decision-answer').value=b.dataset.value;},
  'submit-decision':b=>submitDecision(b.dataset.id),'request-evidence':b=>requestEvidence(b.dataset.id),
  'apply-proposal':b=>applyProposal(b.dataset.id),
  'reject-proposal':b=>{state.decisions.find(d=>d.id===b.dataset.id).status='rejected';state.drawer=null;render();toast('未采纳此建议，员工配置没有改变');},
  'toggle-pause':b=>{const r=run(b.dataset.id);if(r.status==='paused')r.status=r.beforePause||'running';else{r.beforePause=r.status;r.status='paused';}render();toast('已切换运行控制的演示状态');},
  advance:b=>advanceRun(b.dataset.id),replan:b=>replan(b.dataset.id),
  'add-tool':()=>openModal('add-tool'),'tool-detail':b=>openDrawer('tool',b.dataset.name),
  'generation-back':()=>{state.modal.step='input';renderOverlay();},
  'accept-generation':acceptGeneration,
  'add-candidate':()=>{state.modal.candidates.push({name:'新的协作伙伴',role:'由你定义的工作分工',prompt:`${state.modal.prompt}\n自主协作与选择方法，拿不准时向上级提交评估。`});renderOverlay();},
  'remove-candidate':b=>{state.modal.candidates.splice(Number(b.dataset.index),1);renderOverlay();},
  reset:()=>{state=freshStateForReset();navigate('overview');render();toast('演示已重置');},
};
function freshStateForReset() { clearTimeout(state.toastTimer); return freshState(); }
function submitForm(event) {
  const form=event.target.closest('[data-form]');if(!form)return;event.preventDefault();
  const name=form.dataset.form;
  if(name==='start-run')return startRun();
  if(name==='generate')return beginGeneration();
  if(name==='edit-team')return saveTeam(form.dataset.id);
  if(name==='run-message')return sendRunMessage(form.dataset.id);
  if(name==='save-flow') {
    const text=document.querySelector('#flow-prompt').value.trim();if(!text)return toast('请保留有效的协作要求。');
    const t=team(form.dataset.id);t.flow=text;t.version++;render();return toast(`流程 v${t.version} 已保存；在途生效方式待确认 · 演示`);
  }
  if(name==='add-tool') {
    const name=document.querySelector('#tool-name').value.trim();if(!name)return toast('先为连接起一个名称。');
    state.tools.push({name,desc:document.querySelector('#tool-desc').value.trim()||'你添加的示例连接',icon:'link',state:'未验证 · 演示'});state.modal=null;render();return toast('示例连接已添加，未访问真实系统');
  }
}
document.addEventListener('click',event=>{
  if(event.target.hasAttribute('data-backdrop'))return closeOverlay();
  const target=event.target.closest('[data-action]');if(!target)return;
  const handler=actions[target.dataset.action];if(handler){event.preventDefault();handler(target);}
});
document.addEventListener('submit',submitForm);
document.addEventListener('input',event=>{
  const input=event.target;
  if(input.id==='employee-search') {const start=input.selectionStart;state.employeeFilter=input.value;render();const next=document.querySelector('#employee-search');next.focus();next.setSelectionRange(start,start);}
  if(input.hasAttribute('data-draft-key')&&state.modal?.candidates)state.modal.candidates[Number(input.dataset.draftIndex)][input.dataset.draftKey]=input.value;
  if(input.id==='draft-team-name'&&state.modal)state.modal.name=input.value;
  if(input.id==='decision-answer'&&state.drawer)state.drawer.answer=input.value;
  if(input.id==='generation-prompt'&&state.modal)state.modal.prompt=input.value;
});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'){closeOverlay();document.body.classList.remove('nav-open');}
  if(event.key==='Tab'&&(state.modal||state.drawer)) {
    const items=[...document.querySelectorAll('#overlays button:not(:disabled),#overlays input,#overlays textarea,#overlays select,#overlays summary')].filter(el=>el.getClientRects().length);
    if(!items.length)return;const first=items[0],last=items.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  }
});
window.addEventListener('hashchange',()=>{state.drawer=null;state.modal=null;document.body.classList.remove('nav-open');render();});
render();
