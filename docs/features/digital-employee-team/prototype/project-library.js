'use strict';

// Static project library. Every version, conflict and integration is local synthetic data.
function initProjectLibraries() {
  if (!Array.isArray(state.projects)) state.projects = [];
  if (!state.projectLibrariesInitialized) {
    if (team('biz')) state.projects.push(projectSeed('biz', '商机资料与跟进建议', 'local'));
    if (team('dev')) state.projects.push(projectSeed('dev', '工作台体验优化', 'git-example'));
    state.projectLibrariesInitialized = true;
  }
  if (!['doc', 'requirements', 'versions'].includes(state.projectTab)) state.projectTab = 'doc';
}
function projectSeed(teamId, name, versionMode) {
  const id = `project-${teamId}`;
  const p = projectEmpty(id, teamId, name, '把目标、项目资料和并行需求放在同一项目中，保留各自的版本与依据。', versionMode);
  p.documents.push({id:`${id}-doc`, title:'项目目标与共同口径', kind:'项目说明', versions:[
    {number:1, content:'目标：整理资料，形成可核对的成果。\n共同约定：注明事实来源，保留问题与未验证范围。', note:'建立项目说明', time:'09:00'},
    {number:2, content:'目标：整理资料，形成可核对的成果。\n共同约定：注明事实来源及适用版本，区分已知事实和推断。\n待明确：最终优先级由用户决定。', note:'补充资料来源与适用版本口径', time:'09:20'},
  ]});
  p.integrations.push({number:2, summary:'共同口径说明更新 · 种子示例', files:['shared/共同口径'], requirementId:null, requirementName:'项目说明', versionNumber:2, time:'09:20'});
  p.baselineNumber = 2;
  const owners = teamPeople(team(teamId));
  p.requirements.push(projectRequirement(p, '资料与方案整理', '整理当前资料、形成可核对的方案与说明。', owners[0]?.id || '', ['notes/资料与方案'], 2));
  p.requirements.push(projectRequirement(p, '共同口径补充', '补充项目共同口径，同时保留原有资料来源。', owners[1]?.id || '', ['shared/共同口径'], 1));
  return p;
}
function projectEmpty(id, teamId, name, goal, versionMode) {
  return {id, teamId, name, goal, versionMode, baselineNumber:1, documents:[], requirements:[], integrations:[
    {number:1, summary:'建立项目初始基线', files:[], requirementId:null, requirementName:'项目初始化', versionNumber:null, time:'初始'},
  ]};
}
function projectRequirement(p, name, goal, ownerId, files, baseNumber) {
  const id = `requirement-${p.id}-${p.requirements.length + 1}`;
  return {id, name, goal, ownerId, baseNumber, status:'working', branchName:`work/${id}`, workspaceKey:`${p.id}/${id}`,
    documentSnapshot:p.documents.map(d => ({documentId:d.id, title:d.title, version:d.versions.at(-1).number})),
    versions:[{number:1, summary:'建立独立需求版本', files:[...files], time:'刚刚'}]};
}
function projectById(id) { return state.projects?.find(p => p.id === id); }
function projectReq(p, id) { return p?.requirements.find(r => r.id === id); }
function projectDoc(p, id) { return p?.documents.find(d => d.id === id); }
function projectAttrs(p, extra = '') { return `data-project="${esc(p.id)}" ${extra}`; }
function projectMode(p) { return p.versionMode === 'git-example' ? 'Git 样式版本 · 模拟' : '文档与成果版本 · 模拟'; }
function projectStatus(r) { return r.status === 'integrated' ? '<span class="badge green">已模拟集成</span>' : '<span class="badge blue">并行进行中</span>'; }
function projectPeopleOptions(t, selected) {
  return '<option value="">暂不分派</option>' + teamPeople(t).map(p => `<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)} · ${esc(p.role)}</option>`).join('');
}
function projectNotFound() { return '<div class="project-empty empty"><h2>没有找到这项内容</h2><p>项目与资料仅保存在本次本地演示中。</p><a class="btn secondary" href="#/teams">返回团队</a></div>'; }
function renderLibrary(teamId) {
  initProjectLibraries();
  const t = team(teamId); if (!t) return projectNotFound();
  const projects = state.projects.filter(p => p.teamId === t.id);
  const actions = button(`${icon('plus')} 新建项目`, 'project-new', 'primary', `data-team="${esc(t.id)}"`);
  const tabs = typeof teamTabs === 'function' ? teamTabs(t.id, 'library') : '';
  return `${pageHead(`${esc(t.name)} · 项目库`, '同一团队可以管理多个项目。项目资料归档，需求各自保留工作版本。', actions)}${tabs}<div class="library-head"><span class="muted small">${projects.length} 个项目 · 仅本团队可见的合成示例</span></div><div class="library-grid">${projects.map(projectLibraryCard).join('') || `<div class="library-empty card empty"><h3>先为团队建立一个项目</h3><p>可以是软件开发、资料分析或其他工作，不要求连接代码仓库。</p>${actions}</div>`}</div><p class="demo-note project-hint">这里演示项目、文档与并行版本管理。没有数据库、真实 Git 仓库或外部版本工具连接。</p>`;
}
function projectLibraryCard(p) {
  const working = p.requirements.filter(r => r.status !== 'integrated').length;
  return `<a class="card library-card" href="#/project/${esc(p.id)}"><div class="row between"><span class="template-mark">${icon('file')}</span><span class="badge muted">项目基线 v${p.baselineNumber}</span></div><h3 class="library-card-title">${esc(p.name)}</h3><p class="muted small">${esc(p.goal)}</p><div class="library-card-meta"><span>${p.documents.length} 份归档文档</span><span>${working} 项并行需求</span></div><div class="row between"><span class="muted small">${projectMode(p)}</span>${icon('arrow')}</div></a>`;
}
function renderProject(projectId) {
  initProjectLibraries();
  const p = projectById(projectId); if (!p || !team(p.teamId)) return projectNotFound();
  const tabs = [['doc','文档归档'],['requirements','并行需求'],['versions','版本管理']];
  const actions = `<a class="btn secondary" href="#/overview/${esc(p.teamId)}">进入团队群聊</a>${button(`${icon('plus')} 新建需求`, 'project-requirement-new', 'primary', projectAttrs(p))}`;
  const active = state.projectTab || 'doc';
  const content = active === 'requirements' ? projectRequirements(p) : active === 'versions' ? projectVersions(p) : projectDocuments(p);
  return `<a class="breadcrumb-button" href="#/library/${esc(p.teamId)}">${icon('back')} 返回 ${esc(team(p.teamId).name)} 项目库</a>${pageHead(esc(p.name), esc(p.goal), actions)}<div class="project-summary card"><div class="project-summary-item"><span>项目基线</span><b>v${p.baselineNumber}</b></div><div class="project-summary-item"><span>并行需求</span><b>${p.requirements.filter(r=>r.status!=='integrated').length} 项</b></div><div class="project-summary-item"><span>版本工具</span><b>${projectMode(p)}</b></div></div><div class="project-tabs tabs">${tabs.map(([key,label])=>button(label,'project-tab',`tab ${active===key?'active':''}`,projectAttrs(p,`data-tab="${key}"`))).join('')}</div>${content}`;
}
function projectDocuments(p) {
  return `<section class="card"><div class="card-head"><div><h3>项目文档归档</h3><p class="muted small">保存各类项目资料，每次更新形成新版本。</p></div>${button(`${icon('plus')} 归档文档`,'project-doc-new','secondary small',projectAttrs(p))}</div><div class="project-doc-list">${p.documents.map(d=>`<button class="project-doc-row" data-action="project-doc-open" ${projectAttrs(p,`data-doc="${esc(d.id)}"`)}>${icon('file')}<span class="project-doc-main"><b>${esc(d.title)}</b><span class="project-doc-meta">${esc(d.kind)} · v${d.versions.at(-1).number} · ${esc(d.versions.at(-1).note)}</span></span>${icon('chevron')}</button>`).join('') || '<div class="project-empty empty">还没有归档文档。可以保存目标、资料、工作说明或其他成果。</div>'}</div></section>`;
}
function projectRequirements(p) {
  return `<div class="project-head row between"><span class="muted small">每项需求有独立版本与创建时的项目基线；不固定业务步骤。</span>${button(`${icon('plus')} 新建需求`,'project-requirement-new','secondary small',projectAttrs(p))}</div><div class="project-requirements-grid">${p.requirements.map(r=>projectBranchCard(p,r)).join('') || '<div class="card project-empty empty">还没有需求。可以同时创建多项需求，分别推进与保存成果。</div>'}</div>`;
}
function projectBranchCard(p, r) {
  const head = r.versions.at(-1), owner = person(r.ownerId);
  return `<article class="card branch-card"><div class="branch-card-head"><h3>${esc(r.name)}</h3>${projectStatus(r)}</div><p class="muted small">${esc(r.goal)}</p><div class="branch-card-meta"><span>${owner?esc(owner.name):'暂未分派'}</span><span>需求版本 v${head.number}</span></div><div class="branch-base">创建基线 v${r.baseNumber} <span class="muted">/ 项目当前 v${p.baselineNumber}</span></div><div class="branch-base">工作分支 · 模拟<br><span class="muted">${esc(r.branchName)}</span></div><div class="branch-base">隔离工作空间 · 模拟<br><span class="muted">${esc(r.workspaceKey)}</span></div><div class="branch-card-actions">${button('查看需求与版本','project-requirement-open','secondary small',projectAttrs(p,`data-requirement="${esc(r.id)}"`))}${r.status!=='integrated'?button('检查模拟集成','project-merge-check','ghost small',projectAttrs(p,`data-requirement="${esc(r.id)}"`)):''}</div></article>`;
}
function projectVersions(p) {
  return `<div class="notice info project-hint">${icon('info')} ${projectMode(p)}。用本地条目重叠演示冲突，不比较真实文件；实际服务商、仓库映射与合并授权仍待确定。业务项目也可只管理文档与成果版本。</div><section class="card" style="margin-top:18px"><div class="card-head"><div><h3>项目版本与集成记录</h3><p class="muted small">模拟集成后保留历史，其他并行需求不会自动更新基线。</p></div><span class="badge blue">当前 v${p.baselineNumber}</span></div><div class="project-history">${[...p.integrations].reverse().map(v=>`<div class="project-history-item"><div class="row between"><b>项目基线 v${v.number}</b><span class="project-history-meta">${esc(v.time)}</span></div><p>${esc(v.summary)}</p><span class="project-history-meta">${esc(v.requirementName)}${v.versionNumber?` · 需求/资料版本 v${v.versionNumber}`:''}</span></div>`).join('')}</div></section><div class="project-head" style="margin-top:22px"><h3>独立需求版本空间</h3></div><div class="project-requirements-grid">${p.requirements.map(r=>projectBranchCard(p,r)).join('') || '<div class="project-empty muted">建立需求后，可保存独立成果版本并检查模拟集成。</div>'}</div>`;
}
function projectModal(m) {
  if (!m?.type?.startsWith('project-')) return null;
  const p = projectById(m.projectId), t = team(m.teamId || p?.teamId);
  if (m.type === 'project-new') return projectNewModal(t);
  if (!p) return {title:'项目不存在',body:projectNotFound(),foot:button('关闭','close')};
  if (m.type === 'project-doc-new' || m.type === 'project-doc-version') return projectDocumentModal(p,m);
  if (m.type === 'project-requirement-new') return projectRequirementModal(p);
  if (m.type === 'project-version-save') return projectVersionModal(p,projectReq(p,m.requirementId));
  if (m.type === 'project-merge-confirm') return projectMergeModal(p,projectReq(p,m.requirementId));
  return null;
}
function projectNewModal(t) {
  if (!t) return {title:'先选择一个团队',body:'项目需要明确归属的团队。',foot:button('关闭','close')};
  return {kicker:`${esc(t.name)} · 项目库`,title:'新建项目',body:`<form id="project-new-form" data-form="project-new" data-team="${esc(t.id)}"><div class="field"><label for="project-name">项目名称</label><input class="input" id="project-name" placeholder="例如：客户资料研究、工作台改进"></div><div class="field"><label for="project-goal">项目目标与说明</label><textarea class="input" id="project-goal" placeholder="描述要完成的工作，不限制行业或岗位。"></textarea></div><div class="field"><label for="project-mode">版本示例</label><select class="select" id="project-mode"><option value="local">文档与成果版本 · 不要求 Git</option><option value="git-example">Git 样式版本 · 本地模拟</option></select></div><p class="demo-note">创建空项目库，不创建真实仓库，也不会连接外部版本服务。</p><div class="project-form-error" id="project-form-error" role="alert"></div></form>`,foot:`${button('取消','close')}<button class="btn primary" type="submit" form="project-new-form">创建项目</button>`};
}
function projectDocumentModal(p, m) {
  const doc = projectDoc(p,m.documentId), old = doc?.versions.at(-1);
  const requirementOptions = '<option value="">不关联特定需求</option>' + p.requirements.map(r=>`<option value="${esc(r.id)}" ${old?.requirementId===r.id?'selected':''}>${esc(r.name)}</option>`).join('');
  return {kicker:`${esc(p.name)} · 文档归档`,title:doc?'保存文档新版本':'归档项目文档',body:`<form id="project-doc-form" data-form="${doc?'project-doc-version':'project-doc-new'}" ${projectAttrs(p,`data-doc="${esc(doc?.id||'')}" data-version="${old?.number||0}"`)}><div class="field"><label for="project-doc-title">文档名称</label><input class="input" id="project-doc-title" value="${esc(doc?.title||'')}" ${doc?'readonly':''}></div><div class="field"><label for="project-doc-kind">资料类型</label><input class="input" id="project-doc-kind" value="${esc(doc?.kind||'项目资料')}" ${doc?'readonly':''}></div><div class="field"><label for="project-doc-requirement">关联需求（可选）</label><select class="select" id="project-doc-requirement">${requirementOptions}</select></div><div class="field"><label for="project-doc-content">文档内容</label><textarea class="input" id="project-doc-content" rows="10">${esc(old?.content||'')}</textarea></div><div class="field"><label for="project-doc-note">版本说明</label><input class="input" id="project-doc-note" placeholder="说明这次归档或修改了什么"></div><div class="project-form-error" id="project-form-error" role="alert"></div></form>`,foot:`${button('取消','close')}<button class="btn primary" form="project-doc-form" type="submit">${doc?'保存新版本':'归档文档'}</button>`};
}
function projectRequirementModal(p) {
  return {kicker:`${esc(p.name)} · 并行工作`,title:'新建独立需求',body:`<form id="project-requirement-form" data-form="project-requirement-new" ${projectAttrs(p)}><div class="field"><label for="project-requirement-name">需求名称</label><input class="input" id="project-requirement-name" placeholder="用自己的话描述这项工作"></div><div class="field"><label for="project-requirement-goal">目标与预期成果</label><textarea class="input" id="project-requirement-goal"></textarea></div><div class="field"><label for="project-requirement-owner">本团队负责人</label><select class="select" id="project-requirement-owner">${projectPeopleOptions(team(p.teamId),'')}</select></div><div class="field"><label for="project-requirement-files">成果 / 变更条目（每行一项）</label><textarea class="input" id="project-requirement-files" rows="3" placeholder="例如：资料/分析结论&#10;说明/方案比较"></textarea></div><div class="notice info">从项目当前基线 v${p.baselineNumber} 创建独立版本，并保留当前归档文档的版本引用。其他需求独立推进。</div><div class="project-form-error" id="project-form-error" role="alert"></div></form>`,foot:`${button('取消','close')}<button class="btn primary" form="project-requirement-form" type="submit">创建需求与版本空间</button>`};
}
function projectVersionModal(p, r) {
  if (!r || r.status === 'integrated') return {title:'需求不能继续保存',body:'已模拟集成的记录保留为历史。需要新工作时，创建另一项独立需求。',foot:button('关闭','close')};
  const v = r.versions.at(-1);
  return {kicker:`${esc(r.name)} · 独立版本`,title:'记录需求新版本',body:`<form id="project-version-form" data-form="project-version-save" ${projectAttrs(p,`data-requirement="${esc(r.id)}" data-head="${v.number}"`)}><div class="field"><label for="project-version-summary">这次完成或调整了什么</label><input class="input" id="project-version-summary" placeholder="版本说明"></div><div class="field"><label for="project-version-files">当前成果 / 变更条目（每行一项）</label><textarea class="input" id="project-version-files" rows="6">${esc(v.files.join('\n'))}</textarea></div><p class="demo-note">只更新这项需求，基线仍为 v${r.baseNumber}；不会静默跟随项目基线 v${p.baselineNumber}。这里记录合成版本，不执行真实提交。</p><div class="project-form-error" id="project-form-error" role="alert"></div></form>`,foot:`${button('取消','close')}<button class="btn primary" form="project-version-form" type="submit">保存需求版本</button>`};
}
function projectMergeCheck(p, r) {
  const head = r.versions.at(-1);
  const later = p.integrations.filter(v => v.number > r.baseNumber);
  const changed = new Set(later.flatMap(v => v.files));
  const conflicts = head.files.filter(path => changed.has(path));
  return {target:p.baselineNumber, head:head.number, conflicts, files:[...head.files]};
}
function projectMergeModal(p, r) {
  if (!r || r.status === 'integrated') return {title:'这项需求已处理',body:'可以在项目版本中查看集成记录。',foot:button('关闭','close')};
  const check = projectMergeCheck(p,r);
  if (check.conflicts.length) return projectCheckDrawer(p,r);
  return {kicker:'仅本地模拟 · 不执行真实合并',title:'确认模拟集成这项需求？',body:`<p>把「${esc(r.name)}」v${check.head} 模拟加入项目基线 v${check.target + 1}。</p><div class="detail-block"><h3>本次模拟范围</h3><p>需求基线 v${r.baseNumber} → 当前项目 v${check.target}</p><p>没有发现示例条目重叠；这不代表真实 Git 或内容检查通过。</p></div><p class="muted small">只改变本地演示记录。其他并行需求保留原来的基线。正式合并工具、服务商与权限策略尚未决定；本按钮不代表所有实际合并均需人工审批。</p><form id="project-merge-form" data-form="project-merge" ${projectAttrs(p,`data-requirement="${esc(r.id)}" data-baseline="${check.target}" data-head="${check.head}"`)}></form>`,foot:`${button('取消','close')}<button class="btn primary" form="project-merge-form" type="submit">确认模拟集成</button>`};
}
function projectDrawer(d) {
  if (!d?.type?.startsWith('project-')) return null;
  const p = projectById(d.projectId); if (!p) return {title:'项目不存在',body:projectNotFound(),foot:button('关闭','close')};
  if (d.type === 'project-doc') return projectDocumentDrawer(p,projectDoc(p,d.documentId),d.version);
  if (d.type === 'project-requirement') return projectRequirementDrawer(p,projectReq(p,d.requirementId));
  if (d.type === 'project-merge-check') return projectCheckDrawer(p,projectReq(p,d.requirementId));
  return null;
}
function projectDocumentDrawer(p, doc, version) {
  if (!doc) return {title:'文档不存在',body:'请返回项目文档列表。',foot:button('关闭','close')};
  const v = doc.versions.find(v=>v.number===Number(version)) || doc.versions.at(-1);
  const sourceRequirement = projectReq(p,v.requirementId);
  return {kicker:`${esc(p.name)} · ${esc(doc.kind)}`,title:esc(doc.title),body:`<div class="row between"><span class="badge blue">文档 v${v.number}</span><span class="muted small">${esc(v.note)}</span></div><p class="muted small" style="margin-top:12px">来源需求：${sourceRequirement?esc(sourceRequirement.name):"未关联特定需求"}</p><div class="project-doc-preview"><pre>${esc(v.content)}</pre></div><h3>归档版本</h3><div class="project-version-list">${[...doc.versions].reverse().map(item=>`<button class="project-version-item" data-action="project-doc-revision" ${projectAttrs(p,`data-doc="${esc(doc.id)}" data-version="${item.number}"`)}><b>v${item.number}</b><span>${esc(item.note)}</span>${item.number===v.number?'<span class="badge blue">正在查看</span>':''}</button>`).join('')}</div><p class="demo-note">旧版本保留。已有需求引用的文档快照不会因归档新版本而自动改变。</p>`,foot:`${button('关闭','close')}${button('归档文档新版本','project-doc-version','primary',projectAttrs(p,`data-doc="${esc(doc.id)}"`))}`};
}
function projectRequirementDrawer(p, r) {
  if (!r) return {title:'需求不存在',body:'请返回项目。',foot:button('关闭','close')};
  return {kicker:`${esc(p.name)} · 独立需求`,title:esc(r.name),body:`${projectStatus(r)}<div class="detail-block"><h3>工作目标</h3><p>${esc(r.goal)}</p><p class="muted small">负责人：${esc(person(r.ownerId)?.name||'暂未分派')} · 原基线 v${r.baseNumber} · 项目当前 v${p.baselineNumber}</p></div><div class="detail-block"><h3>独立分支与执行空间 · 模拟</h3><p>分支：${esc(r.branchName)}</p><p>工作空间：${esc(r.workspaceKey)}</p><p class="muted small">稳定标识用于展示隔离关系，没有创建真实 Git 分支或沙箱，也不规定正式命名规范。</p></div><div class="detail-block"><h3>创建时的归档文档</h3>${r.documentSnapshot.map(s=>`<p>${esc(s.title)} · v${s.version}</p>`).join('')||'<p class="muted small">创建时还没有归档资料。</p>'}</div><h3>需求版本记录</h3><div class="project-version-list">${[...r.versions].reverse().map(v=>`<div class="project-version-item"><div><b>需求 v${v.number}</b><p>${esc(v.summary)}</p><div class="branch-files">${v.files.map(file=>`<span class="chip">${esc(file)}</span>`).join('')}</div></div></div>`).join('')}</div><p class="demo-note">需求版本相互独立；同团队可同时推进多项工作，流程与岗位不在此固定。</p>`,foot:`${button('关闭','close')}${r.status!=='integrated'?button('记录新版本','project-version-save','primary',projectAttrs(p,`data-requirement="${esc(r.id)}"`)):''}`};
}
function projectCheckDrawer(p, r) {
  if (!r) return {title:'需求不存在',body:'请返回项目。',foot:button('关闭','close')};
  const check = projectMergeCheck(p,r), conflict = check.conflicts.length > 0, integrated = r.status === 'integrated';
  return {kicker:'本地条目检查 · 非真实 Git 检查',title:integrated?'需求已模拟集成':conflict?'存在示例冲突，暂不集成':'示例检查无重叠条目',body:`<div class="notice ${conflict?'amber':'info'}">${conflict?'这项需求与创建基线之后的项目版本修改了相同条目。保留两边的记录，不提供忽略冲突继续集成按钮。':'未发现示例条目重叠；真实内容、测试和合并结果没有验证。'}</div><div class="detail-block"><h3>${esc(r.name)} · 需求 v${check.head}</h3><p>需求原基线 v${r.baseNumber} / 项目当前 v${check.target}</p></div><div class="project-check-list">${check.files.map(file=>`<div class="project-check-item ${check.conflicts.includes(file)?'project-conflict':''}"><span>${esc(file)}</span><span class="badge ${check.conflicts.includes(file)?'red':'muted'}">${check.conflicts.includes(file)?'与基线后变更重叠':'无示例重叠'}</span></div>`).join('') || '<p class="muted small">还没有记录成果或变更条目。</p>'}</div><p class="demo-note">检查只比较本地条目名称，不访问仓库或判断真实内容冲突。真实冲突解决与集成权限需后续设计，不能把本次模拟当作已合并。</p>`,foot:`${button('关闭','close')}${!conflict&&!integrated&&check.files.length?button('继续模拟集成','project-merge-confirm','primary',projectAttrs(p,`data-requirement="${esc(r.id)}"`)):''}`};
}
function handleProjectAction(el) {
  const d = el.dataset, p = projectById(d.project), args = {projectId:d.project, requirementId:d.requirement, documentId:d.doc};
  const actions = {
    'project-new':()=>openModal('project-new',{teamId:d.team}),
    'project-tab':()=>{state.projectTab=d.tab;render();},
    'project-doc-new':()=>openModal('project-doc-new',args),
    'project-doc-open':()=>openDrawer('project-doc',args),
    'project-doc-revision':()=>openDrawer('project-doc',{...args,version:Number(d.version)}),
    'project-doc-version':()=>openModal('project-doc-version',args),
    'project-requirement-new':()=>openModal('project-requirement-new',args),
    'project-requirement-open':()=>openDrawer('project-requirement',args),
    'project-version-save':()=>openModal('project-version-save',args),
    'project-merge-check':()=>openDrawer('project-merge-check',args),
    'project-merge-confirm':()=>openModal('project-merge-confirm',args),
  };
  if (!actions[d.action]) return false;
  if (d.project && !p) { toast('项目不存在，请返回团队项目库。'); return true; }
  actions[d.action](); return true;
}
function handleProjectForm(form) {
  const handlers = {'project-new':projectSaveNew,'project-doc-new':projectSaveDocument,'project-doc-version':projectSaveDocument,'project-requirement-new':projectSaveRequirement,'project-version-save':projectSaveVersion,'project-merge':projectIntegrate};
  if (!handlers[form.dataset.form]) return false;
  handlers[form.dataset.form](form); return true;
}
function projectError(message) {
  const target = document.getElementById('project-form-error');
  if (target) target.textContent = message; else toast(message);
}
function projectSaveNew(form) {
  const t = team(form.dataset.team), name = value('project-name'), goal = value('project-goal');
  if (!t || !name || !goal) return projectError('请填写项目名称与目标，并选择有效团队。');
  const p = projectEmpty(`project-${Date.now()}-${state.projects.length}`,t.id,name,goal,value('project-mode'));
  state.projects.push(p);state.projectTab='doc';closeOverlay();navigate(`project/${p.id}`);toast('项目已加入本团队项目库 · 本地演示');
}
function projectSaveDocument(form) {
  const p = projectById(form.dataset.project); if (!p) return projectError('项目不存在。');
  const title = value('project-doc-title'), content = value('project-doc-content'), note = value('project-doc-note');
  if (!title || !content || !note) return projectError('请填写文档名称、内容和版本说明。');
  const requirementId = value('project-doc-requirement');
  if (requirementId && !projectReq(p,requirementId)) return projectError('关联需求必须来自当前项目。');
  let doc = projectDoc(p,form.dataset.doc);
  if (doc && doc.versions.at(-1).number !== Number(form.dataset.version)) return projectError('文档版本已变化，请重新打开最新版本。');
  if (!doc) {doc={id:`doc-${Date.now()}-${p.documents.length}`,title,kind:value('project-doc-kind')||'项目资料',versions:[]};p.documents.push(doc);}
  doc.versions.push({number:doc.versions.length+1,content,note,requirementId:requirementId||null,time:'刚刚'});
  state.projectTab='doc';closeOverlay();render();toast('文档已归档为新版本，旧版本保留 · 演示');
}
function projectFileValues(id) { return [...new Set(value(id).split(/[\n,，]/).map(s=>s.trim()).filter(Boolean))]; }
function projectSaveRequirement(form) {
  const p = projectById(form.dataset.project), name=value('project-requirement-name'), goal=value('project-requirement-goal');
  if (!p || !name || !goal) return projectError('请填写需求名称与目标。');
  const ownerId=value('project-requirement-owner'), files=projectFileValues('project-requirement-files');
  if (ownerId && !team(p.teamId).members.includes(ownerId)) return projectError('负责人只能来自本团队。');
  if (!files.length) return projectError('至少填写一项成果或变更条目，供版本示例引用。');
  p.requirements.push(projectRequirement(p,name,goal,ownerId,files,p.baselineNumber));
  state.projectTab='requirements';closeOverlay();render();toast(`已创建独立需求，基于项目 v${p.baselineNumber} · 演示`);
}
function projectSaveVersion(form) {
  const p=projectById(form.dataset.project),r=projectReq(p,form.dataset.requirement),summary=value('project-version-summary'),files=projectFileValues('project-version-files');
  if (!r || r.status==='integrated') return projectError('需求已不存在或已经模拟集成。');
  if (r.versions.at(-1).number!==Number(form.dataset.head)) return projectError('需求版本已经变化，请重新打开。');
  if (!summary || !files.length) return projectError('请填写版本说明及至少一个成果条目。');
  r.versions.push({number:r.versions.length+1,summary,files,time:'刚刚'});
  closeOverlay();render();toast('需求新版本已记录；其他需求与原基线保持独立 · 演示');
}
function projectIntegrate(form) {
  const p=projectById(form.dataset.project),r=projectReq(p,form.dataset.requirement);
  if (!r) return toast('需求不存在。');
  if (r.status==='integrated') {closeOverlay();render();toast('这项需求已有模拟集成记录。');return;}
  const check=projectMergeCheck(p,r);
  if (check.target!==Number(form.dataset.baseline)||check.head!==Number(form.dataset.head)) return toast('项目或需求版本已变化，请关闭并重新检查，未执行模拟集成。');
  if (check.conflicts.length||!check.files.length) return toast('仍有示例冲突或缺少成果条目，未执行模拟集成。');
  p.baselineNumber++;
  p.integrations.push({number:p.baselineNumber,summary:`模拟集成「${r.name}」v${check.head}`,files:[...check.files],requirementId:r.id,requirementName:r.name,versionNumber:check.head,time:'刚刚'});
  r.status='integrated';r.integratedBaseline=p.baselineNumber;
  state.projectTab='versions';closeOverlay();render();toast('已记录本地模拟集成；其他并行需求基线未自动改变');
}
