'use strict';

// Local synthetic knowledge library. Employees can read mounted sources, never write them.
function initKnowledgeLibraries() {
  if (!Array.isArray(state.knowledgeItems)) state.knowledgeItems = [];
  if (!Array.isArray(state.knowledgeMounts)) state.knowledgeMounts = [];
  if (!Number.isInteger(state.knowledgeMountRevision)) state.knowledgeMountRevision = 1;
  if (state.knowledgeLibrariesInitialized) return;
  state.knowledgeLibrariesInitialized = true;
  const seeds = [
    ['knowledge-sources','事实来源与引用说明','整理资料、形成判断时可查阅的共同参考。','区分原始事实、推断与缺失信息。\n引用资料时保留名称、来源和适用版本。\n缺少依据时明确未验证，不将员工判断视为实际核查结果。'],
    ['knowledge-context','业务资料口径说明','用于理解本地业务示例中的资料字段。','本原型中的客户、商机和指标均为合成资料。\n示例字段：目标、资料来源、时间范围和核查状态。\n优先级取舍需要结合用户当前目标，不由资料说明自动决定。'],
    ['knowledge-reference','工作成果核查参考','核查成果及其版本时可查阅的资料。','明确检查对象与版本，区分提出问题、修正和复核。\n保存失败及未验证范围，不以相互认可替代真实结果。\n知识源只提供参考，不代表在途工作已经读取或采用新版。'],
  ];
  for (const [id,title,description,content] of seeds) {
    if (!state.knowledgeItems.some(k=>k.id===id)) state.knowledgeItems.push({id,title,description,versions:[Object.freeze({number:1,title,description,content,reason:'建立合成示例知识源',actorType:'user',actorId:'user',time:'初始'})]});
  }
  for (const [employeeId,knowledgeId] of [['dev-review','knowledge-sources'],['biz-review','knowledge-sources'],['biz-analyse','knowledge-context'],['dev-build','knowledge-reference'],['ops-lead','knowledge-reference']]) {
    if (person(employeeId) && !state.knowledgeMounts.some(m=>m.employeeId===employeeId&&m.knowledgeId===knowledgeId)) state.knowledgeMounts.push({employeeId,knowledgeId});
  }
}
function knowledgeById(id) { return state.knowledgeItems?.find(k=>k.id===id); }
function knowledgeLatest(item) { return item.versions.at(-1); }
function knowledgeEmployeeMounts(employeeId) { return (state.knowledgeMounts||[]).filter(m=>m.employeeId===employeeId); }
function knowledgeMountedPeople(knowledgeId) { return (state.knowledgeMounts||[]).filter(m=>m.knowledgeId===knowledgeId).map(m=>person(m.employeeId)).filter(Boolean); }
function knowledgeReadonlyBadge() { return '<span class="badge muted knowledge-mode">员工只读</span>'; }
function knowledgeMissing() { return '<div class="empty"><h3>没有找到这项知识</h3><p>知识内容仅保存在本次本地演示中。</p><a class="btn secondary" href="#/knowledge">返回知识库</a></div>'; }
function renderKnowledgeLibrary() {
  initKnowledgeLibraries();
  const actions=button(`${icon('plus')} 新增知识源`,'knowledge-new','primary');
  return `${pageHead('知识库','维护可追溯的共同资料，按员工挂载。数字员工只能查阅知识，不能修改知识库。',actions)}<div class="notice info">用户可新增修订版，旧版本保持不变。共享源修订后，所有已挂载员工可看到最新版本；未挂载员工不会继承。</div><div class="knowledge-grid">${state.knowledgeItems.map(k=>`<a class="card knowledge-card" href="#/knowledge-item/${esc(k.id)}"><div class="knowledge-card-head"><span class="template-mark">${icon('file')}</span>${knowledgeReadonlyBadge()}</div><h3>${esc(k.title)}</h3><p class="muted small">${esc(k.description)}</p><div class="knowledge-card-meta"><span>用户修订 v${knowledgeLatest(k).number}</span><span>${knowledgeMountedPeople(k.id).length} 位员工挂载</span></div><span class="small">查看知识与版本 ${icon('arrow')}</span></a>`).join('')||'<div class="card empty">还没有知识源，可以先新增一份参考资料。</div>'}</div><p class="demo-note">本地合成演示，没有真实知识检索、RAG、模型或后台。模板可变与知识只读是不同规则。</p>`;
}
function renderKnowledgeItem(id) {
  initKnowledgeLibraries();
  const k=knowledgeById(id);if(!k)return knowledgeMissing();
  const v=knowledgeLatest(k),people=knowledgeMountedPeople(k.id);
  const actions=`${button('管理挂载员工','knowledge-mounts','secondary',`data-knowledge="${esc(k.id)}"`)}${button(`${icon('edit')} 用户新增修订版`,'knowledge-edit','primary',`data-knowledge="${esc(k.id)}"`)}`;
  return `<a class="breadcrumb-button" href="#/knowledge">${icon('back')} 返回知识库</a>${pageHead(esc(k.title),esc(k.description),actions)}<div class="knowledge-layout"><section class="card knowledge-main"><div class="card-head"><h3>当前共享源</h3><div class="row">${knowledgeReadonlyBadge()}<span class="badge blue">v${v.number}</span></div></div><div class="card-body"><div class="knowledge-content"><pre>${esc(v.content)}</pre></div><div class="knowledge-source">我 · ${esc(v.reason)} · ${esc(v.time)}</div></div></section><aside class="knowledge-side"><section class="card knowledge-section"><div class="card-head"><h3>已挂载员工</h3><span class="badge muted">${people.length}</span></div><div class="card-body knowledge-mount-list">${people.map(p=>`<div class="knowledge-mount-row"><span class="avatar ${esc(p.color||'blue')}">${esc(p.name.slice(-1))}</span><div><b>${esc(p.name)}</b><p class="muted small">${esc(team(p.teamId)?.name||'所属团队')} · 可见 v${v.number}</p></div></div>`).join('')||'<p class="muted small">尚未挂载给任何员工。</p>'}</div></section><section class="card knowledge-section"><div class="card-head"><h3>修订历史</h3>${button('查看历史','knowledge-history','ghost small',`data-knowledge="${esc(k.id)}"`)}</div><div class="card-body"><p class="muted small">共 ${k.versions.length} 个不可变版本，全部由用户维护。员工没有知识写入入口。</p></div></section></aside></div><div class="notice info" style="margin-top:20px">最新源版本对已挂载员工可见，不代表正在进行的工作已读取或自动采用新版；实际采用版本需在运行中单独记录。</div>`;
}
function employeeKnowledgeSummary(employeeId) {
  const mounts=knowledgeEmployeeMounts(employeeId).map(m=>knowledgeById(m.knowledgeId)).filter(Boolean);
  if(!mounts.length)return '<p class="muted small">未挂载知识。同团队其他员工的挂载不会自动共享给此员工。</p>';
  return `<div class="knowledge-summary">${mounts.map(k=>`<a href="#/knowledge-item/${esc(k.id)}"><span>${esc(k.title)}</span><span class="badge muted">只读 · 可见 v${knowledgeLatest(k).number}</span></a>`).join('')}</div>`;
}
function renderEmployeeKnowledge(teamId) {
  initKnowledgeLibraries();
  const t=team(teamId);if(!t)return knowledgeMissing();
  const people=teamPeople(t),count=people.reduce((n,p)=>n+knowledgeEmployeeMounts(p.id).length,0);
  const tabs=typeof teamTabs==='function'?teamTabs(t.id,'knowledge'):'';
  return `${pageHead(`${esc(t.name)} · 员工知识`,'按员工配置知识挂载；知识可以共享，实际员工仍只属于一个团队。')} ${tabs}<div class="row between"><span class="muted small">${people.length} 位员工 · ${count} 条挂载关系</span><a class="btn secondary small" href="#/knowledge">管理知识源 ${icon('arrow')}</a></div><div class="employee-knowledge-list">${people.map(p=>`<section class="card employee-knowledge-card"><div class="employee-knowledge-head"><div class="row"><span class="avatar ${esc(p.color||'blue')}">${esc(p.name.slice(-1))}</span><div><h3>${esc(p.name)}</h3><p class="muted small">${esc(p.role)}</p></div></div>${button('管理此员工挂载','knowledge-employee-mounts','secondary small',`data-employee="${esc(p.id)}"`)}</div><div class="employee-knowledge-mounts">${employeeKnowledgeSummary(p.id)}</div></section>`).join('')||'<div class="card empty">团队还没有员工。从模板创建员工后，可以逐人挂载知识。</div>'}</div><p class="demo-note">页面只显示各员工实际挂载关系，未挂载知识不会因为属于同团队而继承。</p>`;
}
function knowledgeModal(m) {
  if(!m?.type?.startsWith('knowledge-'))return null;
  if(m.type==='knowledge-new'||m.type==='knowledge-edit')return knowledgeEditModal(knowledgeById(m.knowledgeId),m.type==='knowledge-new');
  if(m.type==='knowledge-mounts')return knowledgeMountModal(knowledgeById(m.knowledgeId));
  if(m.type==='knowledge-employee-mounts')return knowledgeEmployeeModal(person(m.employeeId));
  return null;
}
function knowledgeEditModal(k,isNew) {
  if(!isNew&&!k)return {title:'知识不存在',body:knowledgeMissing(),foot:button('关闭','close')};
  const v=k?knowledgeLatest(k):null,formType=isNew?'knowledge-new':'knowledge-edit';
  return {kicker:'用户维护 · 不修改历史版本',title:isNew?'新增知识源':'新增知识修订版',body:`<form id="knowledge-edit-form" data-form="${formType}" data-knowledge="${esc(k?.id||'')}" data-version="${v?.number||0}"><div class="field"><label for="knowledge-title">知识名称</label><input class="input" id="knowledge-title" value="${esc(k?.title||'')}"></div><div class="field"><label for="knowledge-description">用途说明</label><input class="input" id="knowledge-description" value="${esc(k?.description||'')}"></div><div class="field"><label for="knowledge-content">知识内容</label><textarea class="input" id="knowledge-content" rows="11">${esc(v?.content||'')}</textarea></div><div class="field"><label for="knowledge-reason">${isNew?'归档说明':'修订理由'}</label><textarea class="input" id="knowledge-reason" rows="3" placeholder="说明资料来源或本次调整依据。"></textarea></div><p class="demo-note">员工始终只读。用户保存形成新版本，旧版本不会覆盖。</p><div class="knowledge-form-error" id="knowledge-form-error" role="alert"></div></form>`,foot:`${button('取消','close')}<button class="btn primary" type="submit" form="knowledge-edit-form">${isNew?'保存知识源':'保存新修订版'}</button>`};
}
function knowledgeMountModal(k) {
  if(!k)return {title:'知识不存在',body:knowledgeMissing(),foot:button('关闭','close')};
  const mounted=new Set(knowledgeMountedPeople(k.id).map(p=>p.id));
  return {kicker:`${esc(k.title)} · 共享资料`,title:'管理挂载员工',body:`<form id="knowledge-mounts-form" data-form="knowledge-mounts" data-knowledge="${esc(k.id)}" data-revision="${state.knowledgeMountRevision}"><p class="muted small">只调整此知识源的员工挂载，可共享给不同团队中的员工；不会移动员工的团队归属。</p><div class="knowledge-employee-options">${state.people.map(p=>`<label class="knowledge-employee-option"><input type="checkbox" name="knowledge-employee" value="${esc(p.id)}" ${mounted.has(p.id)?'checked':''}><span><b>${esc(p.name)}</b><small>${esc(team(p.teamId)?.name||'所属团队')} · ${esc(p.role)}</small></span></label>`).join('')||'<p class="muted small">先在团队中创建员工。</p>'}</div><div class="knowledge-form-error" id="knowledge-form-error" role="alert"></div></form>`,foot:`${button('取消','close')}<button class="btn primary" type="submit" form="knowledge-mounts-form">保存挂载关系</button>`};
}
function knowledgeEmployeeModal(p) {
  if(!p)return {title:'员工不存在',body:'请返回团队重新选择员工。',foot:button('关闭','close')};
  const mounted=new Set(knowledgeEmployeeMounts(p.id).map(m=>m.knowledgeId));
  return {kicker:`${esc(team(p.teamId)?.name||'所属团队')} · 仅此员工`,title:`为 ${esc(p.name)} 挂载知识`,body:`<form id="knowledge-employee-mounts-form" data-form="knowledge-employee-mounts" data-employee="${esc(p.id)}" data-revision="${state.knowledgeMountRevision}"><p class="muted small">本次保存仅改变 ${esc(p.name)} 的挂载，不影响同团队或其他团队的员工。</p><div class="knowledge-employee-options">${state.knowledgeItems.map(k=>`<label class="knowledge-employee-option"><input type="checkbox" name="knowledge-source" value="${esc(k.id)}" ${mounted.has(k.id)?'checked':''}><span><b>${esc(k.title)}</b><small>员工只读 · 当前共享源 v${knowledgeLatest(k).number}</small></span></label>`).join('')||'<p class="muted small">还没有知识源，可以先到知识库新增。</p>'}</div><div class="knowledge-form-error" id="knowledge-form-error" role="alert"></div></form>`,foot:`${button('取消','close')}<button class="btn primary" type="submit" form="knowledge-employee-mounts-form">保存此员工挂载</button>`};
}
function knowledgeDrawer(d) {
  if(!['knowledge-history','knowledge-version'].includes(d?.type))return null;
  const k=knowledgeById(d.knowledgeId);if(!k)return {title:'知识不存在',body:knowledgeMissing(),foot:button('关闭','close')};
  const v=k.versions.find(v=>v.number===Number(d.version))||knowledgeLatest(k);
  return {kicker:'知识修订历史 · 员工只读',title:esc(k.title),body:`<div class="row between"><span class="badge blue">正在查看 v${v.number}</span><span class="muted small">来源：用户维护</span></div><div class="knowledge-content"><pre>${esc(v.content)}</pre></div><div class="knowledge-source">${esc(v.reason)} · ${esc(v.time)}</div><h3 style="margin-top:24px">全部修订版</h3><div class="knowledge-version-list">${[...k.versions].reverse().map(item=>`<button class="knowledge-version-item" data-action="knowledge-version" data-knowledge="${esc(k.id)}" data-version="${item.number}"><b>v${item.number}</b><span>${esc(item.reason)}</span>${item.number===v.number?'<span class="badge blue">查看中</span>':''}</button>`).join('')}</div><p class="demo-note">查看历史不会切换共享源，也不代表员工当前运行正在使用这个版本。历史修订不可原地修改。</p>`,foot:button('关闭','close')};
}
function handleKnowledgeAction(el) {
  const d=el.dataset,actions={
    'knowledge-new':()=>openModal('knowledge-new'),
    'knowledge-edit':()=>openModal('knowledge-edit',{knowledgeId:d.knowledge}),
    'knowledge-mounts':()=>openModal('knowledge-mounts',{knowledgeId:d.knowledge}),
    'knowledge-employee-mounts':()=>openModal('knowledge-employee-mounts',{employeeId:d.employee}),
    'knowledge-history':()=>openDrawer('knowledge-history',{knowledgeId:d.knowledge}),
    'knowledge-version':()=>openDrawer('knowledge-version',{knowledgeId:d.knowledge,version:Number(d.version)}),
    'knowledge-open':()=>navigate(`knowledge-item/${d.knowledge}`),
  };
  if(!actions[d.action])return false;actions[d.action]();return true;
}
function handleKnowledgeForm(form) {
  if(['knowledge-new','knowledge-edit'].includes(form.dataset.form)){knowledgeSaveEdit(form);return true;}
  if(['knowledge-mounts','knowledge-employee-mounts'].includes(form.dataset.form)){knowledgeSaveMounts(form);return true;}
  return false;
}
function knowledgeError(message) {
  const target=document.getElementById('knowledge-form-error');if(target)target.textContent=message;else toast(message);
}
function knowledgeWriteVersion(request) {
  if(request.actorType!=='user'||request.actorId!=='user')return {ok:false,error:'知识库对数字员工只读，员工不能新增、修订或改写知识。'};
  let k=knowledgeById(request.knowledgeId);
  if(request.knowledgeId&&!k)return {ok:false,error:'知识源不存在。'};
  if(k&&knowledgeLatest(k).number!==Number(request.expectedVersion))return {ok:false,error:'共享源版本已变化，请重新打开最新版本；没有覆盖现有内容。'};
  if(!request.title?.trim()||!request.content?.trim()||!request.reason?.trim())return {ok:false,error:'请填写知识名称、内容以及归档或修订说明。'};
  if(!k){k={id:`knowledge-${Date.now()}-${state.knowledgeItems.length}`,title:'',description:'',versions:[]};state.knowledgeItems.push(k);}
  const version=Object.freeze({number:k.versions.length+1,title:request.title.trim(),description:request.description?.trim()||'',content:request.content.trim(),reason:request.reason.trim(),actorType:'user',actorId:'user',time:'刚刚'});
  k.versions.push(version);k.title=version.title;k.description=version.description;
  return {ok:true,knowledgeId:k.id,version:version.number};
}
function knowledgeWriteMounts(request) {
  if(request.actorType!=='user'||request.actorId!=='user')return {ok:false,error:'员工不能自行修改知识挂载；本入口仅供用户维护。'};
  if(Number(request.expectedRevision)!==state.knowledgeMountRevision)return {ok:false,error:'挂载关系已变化，请重新打开；没有覆盖其他修改。'};
  const selected=[...new Set(request.selectedIds||[])];
  if(request.scope==='employee'){
    if(!person(request.targetId)||selected.some(id=>!knowledgeById(id)))return {ok:false,error:'员工或知识源不存在。'};
    state.knowledgeMounts=state.knowledgeMounts.filter(m=>m.employeeId!==request.targetId).concat(selected.map(id=>({employeeId:request.targetId,knowledgeId:id})));
  }else if(request.scope==='knowledge'){
    if(!knowledgeById(request.targetId)||selected.some(id=>!person(id)))return {ok:false,error:'知识源或员工不存在。'};
    state.knowledgeMounts=state.knowledgeMounts.filter(m=>m.knowledgeId!==request.targetId).concat(selected.map(id=>({employeeId:id,knowledgeId:request.targetId})));
  }else return {ok:false,error:'无法识别挂载范围。'};
  state.knowledgeMountRevision++;return {ok:true,revision:state.knowledgeMountRevision};
}
function knowledgeSaveEdit(form) {
  const result=knowledgeWriteVersion({actorType:'user',actorId:'user',knowledgeId:form.dataset.knowledge||null,expectedVersion:Number(form.dataset.version),title:value('knowledge-title'),description:value('knowledge-description'),content:value('knowledge-content'),reason:value('knowledge-reason')});
  if(!result.ok)return knowledgeError(result.error);
  closeOverlay();navigate(`knowledge-item/${result.knowledgeId}`);render();toast('用户修订版已保存，已挂载员工可见最新源；在途采用版本未自动改变 · 演示');
}
function knowledgeSaveMounts(form) {
  const employeeScope=form.dataset.form==='knowledge-employee-mounts';
  const selectedIds=[...form.querySelectorAll('input[type="checkbox"]:checked')].map(el=>el.value);
  const result=knowledgeWriteMounts({actorType:'user',actorId:'user',scope:employeeScope?'employee':'knowledge',targetId:employeeScope?form.dataset.employee:form.dataset.knowledge,expectedRevision:Number(form.dataset.revision),selectedIds});
  if(!result.ok)return knowledgeError(result.error);
  closeOverlay();render();toast(employeeScope?'仅此员工的知识挂载已保存 · 演示':'此知识源的员工挂载已保存 · 演示');
}
