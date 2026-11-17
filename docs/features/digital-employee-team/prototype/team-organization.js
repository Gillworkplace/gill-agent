'use strict';

// Isolated organization draft: no backend, model call, template change or live-run migration.
function initTeamOrganization() {
  if (!state.organizationDrafts) state.organizationDrafts = {};
  bindOrganizationDrag();
}
function organizationPeople(t) { return state.people.filter(p=>p.teamId===t.id); }
function organizationFingerprint(t) {
  return JSON.stringify({version:t.organizationVersion||1,members:[...(t.members||[])].sort(),people:organizationPeople(t).map(p=>({id:p.id,teamId:p.teamId,parentId:p.parentId??'',role:p.role||''})).sort((a,b)=>a.id.localeCompare(b.id))});
}
function organizationRows(t) {
  return Object.fromEntries(organizationPeople(t).map(p=>[p.id,{parentId:p.parentId??'',role:p.role||''}]));
}
function organizationNewDraft(t, selectedId) {
  const rows=organizationRows(t),people=organizationPeople(t);
  return {teamId:t.id,baseline:organizationFingerprint(t),initialRows:JSON.stringify(rows),rows,history:[],dirty:false,selectedId:people.some(p=>p.id===selectedId)?selectedId:people[0]?.id||'user'};
}
function organizationDraft(t) {
  if (!state.organizationDrafts) state.organizationDrafts = {};
  let draft=state.organizationDrafts[t.id];
  if (!draft || (!draft.dirty&&draft.baseline!==organizationFingerprint(t))) draft=state.organizationDrafts[t.id]=organizationNewDraft(t,draft?.selectedId);
  for (const p of organizationPeople(t)) if (!draft.rows[p.id]) draft.rows[p.id]={parentId:p.parentId??'',role:p.role||''};
  return draft;
}
function organizationParentLabel(id) {
  if (id==='user') return '我 · 最终反馈用户';
  return person(id)?.name || (id?`缺失的员工（${id}）`:'未配置上级');
}
function organizationProblems(t, rows) {
  const people=organizationPeople(t),ids=new Set(people.map(p=>p.id)),issues=[],cycleIds=new Set();
  for (const p of people) {
    const parentId=rows[p.id]?.parentId;
    if (!parentId) issues.push({employeeId:p.id,message:`${p.name} 未配置直属上级。`});
    else if (parentId===p.id) issues.push({employeeId:p.id,message:`${p.name} 的直属上级指向自己。`});
    else if (parentId!=='user'&&!ids.has(parentId)) issues.push({employeeId:p.id,message:`${p.name} 的上级不在本团队或已缺失：${organizationParentLabel(parentId)}。`});
    const seen=new Map(),path=[];let current=p.id;
    while (current&&current!=='user'&&ids.has(current)) {
      if (seen.has(current)) {for(const id of path.slice(seen.get(current)))cycleIds.add(id);break;}
      seen.set(current,path.length);path.push(current);current=rows[current]?.parentId;
    }
  }
  for(const id of cycleIds) if(rows[id]?.parentId!==id)issues.push({employeeId:id,message:`${person(id)?.name||id} 所在的上级关系成环，需要修复。`});
  return issues;
}
function organizationCanParent(t, draft, employeeId, parentId) {
  const employee=person(employeeId),parent=person(parentId);
  if (!employee||employee.teamId!==t.id||!draft.rows[employeeId]) return {ok:false,error:'只能调整本团队的有效员工。'};
  if (parentId===employeeId) return {ok:false,error:'员工不能成为自己的直属上级。'};
  if (parentId!=='user'&&(!parent||parent.teamId!==t.id||!draft.rows[parentId])) return {ok:false,error:'上级必须是本团队员工或你，不能跨团队调整。'};
  let current=parentId;const seen=new Set();
  while(current&&current!=='user') {
    if(current===employeeId)return {ok:false,error:'不能把员工移到自己的下级之下，这会形成循环。'};
    if(seen.has(current))return {ok:false,error:'所选上级的关系已经成环，请先修复该关系。'};
    seen.add(current);const row=draft.rows[current];
    if(!row)return {ok:false,error:'所选上级的汇报路径不完整，请先修复。'};
    current=row.parentId;
    if(!current)return {ok:false,error:'所选上级尚未配置有效汇报路径，请先修复。'};
  }
  return {ok:true};
}
function organizationApplyDraft(teamId, employeeId, parentId, role) {
  const t=team(teamId);if(!t)return {ok:false,error:'团队不存在。'};
  const draft=organizationDraft(t),allowed=organizationCanParent(t,draft,employeeId,parentId);
  if(!allowed.ok)return allowed;
  const nextRole=role===undefined?draft.rows[employeeId].role:role;
  if(draft.rows[employeeId].parentId===parentId&&draft.rows[employeeId].role===nextRole)return {ok:true,changed:false};
  draft.history.push(JSON.stringify(draft.rows));draft.rows[employeeId]={parentId,role:nextRole};
  draft.selectedId=employeeId;draft.dirty=JSON.stringify(draft.rows)!==draft.initialRows;
  return {ok:true,changed:true};
}
function organizationReachable(rows) {
  const found=new Set(),queue=['user'];
  while(queue.length){const parent=queue.shift();for(const [id,row]of Object.entries(rows))if(row.parentId===parent&&!found.has(id)){found.add(id);queue.push(id);}}
  return found;
}
function renderTeamOrganization(t) {
  const draft=organizationDraft(t),people=organizationPeople(t),issues=organizationProblems(t,draft.rows);
  if(!people.length)return `<section class="card organization-empty"><div class="empty"><h3>先为团队创建一位员工</h3><p>从模板创建本团队的独立员工，再用树安排上下级。</p>${button(`${icon('plus')} 从模板创建员工`,'new-member','primary',`data-team="${esc(t.id)}"`)}</div></section>`;
  const reachable=organizationReachable(draft.rows),unplaced=people.filter(p=>!reachable.has(p.id));
  return `<section class="organization-toolbar"><div><h3>团队组织</h3><p class="muted small">拖动员工到上级节点，或在右侧选择直属上级。</p></div><div class="organization-actions"><span class="badge ${draft.dirty?'amber':'muted'}">${draft.dirty?'未保存的组织草稿':`已保存 v${t.organizationVersion||1}`}</span>${button('撤销一步','organization-undo','secondary small',`data-team="${esc(t.id)}" ${draft.history.length?'':'disabled'}`)}${button('重新读取','organization-reset','ghost small',`data-team="${esc(t.id)}"`)}${button('保存层级','organization-save','primary small',`data-team="${esc(t.id)}" ${draft.dirty?'':'disabled'}`)}</div></section>${issues.length?`<div class="organization-issues notice amber"><b>有 ${issues.length} 项关系问题，未自动归到根节点。</b>${issues.map(i=>`<p>${esc(i.message)}</p>`).join('')}</div>`:''}<div class="organization-layout"><section class="card organization-tree-card"><div class="organization-tree" aria-label="本团队上下级关系">${organizationRootNode(t,draft)}<div class="organization-children">${people.filter(p=>draft.rows[p.id]?.parentId==='user').map(p=>organizationBranch(t,p.id,draft,new Set())).join('')}</div></div>${unplaced.length?`<div class="organization-unplaced"><h3>关系待修复</h3><p class="muted small">以下员工尚无有效根路径。选择节点，指定有效上级，或拖到根节点修复。</p><div class="organization-unplaced-nodes">${unplaced.map(p=>organizationEmployeeNode(t,p.id,draft,true)).join('')}</div></div>`:''}</section><aside class="card organization-detail">${organizationSelectedPanel(t,draft)}</aside></div><p class="demo-note organization-note">上下级用于拿不准问题的逐级评估，与相互监督关系分开。这里只有本地组织草稿；保存不修改模板 Prompt，也不代表在途工作已采用新层级。</p>`;
}
function organizationRootNode(t, draft) {
  return `<button class="organization-node organization-root ${draft.selectedId==='user'?'selected':''}" data-action="organization-select" data-team="${esc(t.id)}" data-employee="user" data-org-drop="true" data-org-team="${esc(t.id)}" data-org-employee="user" aria-pressed="${draft.selectedId==='user'}"><span class="avatar blue">我</span><span class="organization-node-text"><b>我</b><small>团队管理者 · 最终反馈用户</small></span><span class="organization-root-hint">拖到这里，直接向我汇报</span></button>`;
}
function organizationEmployeeNode(t, id, draft, invalid) {
  const p=person(id);if(!p||p.teamId!==t.id)return '';
  const row=draft.rows[id];
  return `<button class="organization-node ${draft.selectedId===id?'selected':''} ${invalid?'invalid':''}" data-action="organization-select" data-team="${esc(t.id)}" data-employee="${esc(id)}" draggable="true" data-org-draggable="true" data-org-drop="true" data-org-team="${esc(t.id)}" data-org-employee="${esc(id)}" aria-pressed="${draft.selectedId===id}" title="${esc(`拖动调整上级；当前上级：${organizationParentLabel(row.parentId)}`)}"><span class="avatar ${esc(p.color||'blue')}">${esc(p.name.slice(-1))}</span><span class="organization-node-text"><b>${esc(p.name)}</b><small>${esc(row.role||'未填写分工')}</small>${invalid?`<small class="organization-invalid-hint">上级：${esc(organizationParentLabel(row.parentId))}</small>`:''}</span><span class="organization-drag-handle" aria-hidden="true">⠿</span></button>`;
}
function organizationBranch(t, id, draft, seen) {
  if(seen.has(id))return '';const path=new Set(seen);path.add(id);
  const children=organizationPeople(t).filter(p=>draft.rows[p.id]?.parentId===id);
  return `<div class="organization-branch">${organizationEmployeeNode(t,id,draft,false)}${children.length?`<div class="organization-children">${children.map(p=>organizationBranch(t,p.id,draft,path)).join('')}</div>`:''}</div>`;
}
function organizationSelectedPanel(t, draft) {
  const p=person(draft.selectedId);
  if(!p||p.teamId!==t.id)return `<div class="card-body"><h3>团队管理者</h3><p class="muted small">最高层仍拿不准的问题最终反馈给你。用户不是数字员工节点。</p><div class="detail-block"><p>${organizationPeople(t).length} 位员工，仅属于 ${esc(t.name)}。</p><p>拖到根节点，可预览该员工直接向你汇报。</p></div>${button('从模板创建员工','new-member','secondary small',`data-team="${esc(t.id)}"`)}</div>`;
  const row=draft.rows[p.id],validParent=organizationCanParent(t,draft,p.id,row.parentId).ok;
  const options=organizationPeople(t).filter(other=>organizationCanParent(t,draft,p.id,other.id).ok);
  const parentField=`organization-parent-${t.id}`,roleField=`organization-role-${t.id}`;
  return `<div class="card-head"><div><h3>${esc(p.name)}</h3><p class="muted small">${esc(t.name)} · 本团队专属员工</p></div><span class="avatar ${esc(p.color||'blue')}">${esc(p.name.slice(-1))}</span></div><div class="card-body"><p class="muted small">草稿中的直属上级</p><p class="organization-current-parent">${esc(organizationParentLabel(row.parentId))}</p><form class="organization-form" data-form="organization-employee" data-team="${esc(t.id)}" data-employee="${esc(p.id)}"><div class="field"><label for="${esc(parentField)}">更换直属上级</label><select class="select" id="${esc(parentField)}"><option value="" disabled ${validParent?'':'selected'}>请选择有效上级</option><option value="user" ${row.parentId==='user'?'selected':''}>我 · 最终反馈用户</option>${options.map(other=>`<option value="${esc(other.id)}" ${row.parentId===other.id?'selected':''}>${esc(other.name)} · ${esc(draft.rows[other.id].role||'未填写分工')}</option>`).join('')}</select><p class="demo-note">不会列出自己、下级或其他团队员工。</p></div><div class="field"><label for="${esc(roleField)}">本团队的主要分工</label><input class="input" id="${esc(roleField)}" value="${esc(row.role)}" placeholder="开放描述分工，不修改模板 Prompt"></div><button class="btn secondary" type="submit">应用到组织草稿</button></form><div class="organization-detail-actions">${button('管理员工知识挂载','knowledge-employee-mounts','ghost small',`data-employee="${esc(p.id)}"`)}${button('查看员工配置','person','ghost small',`data-id="${esc(p.id)}"`)}</div><p class="demo-note">拖动与表单都只修改草稿，点击“保存层级”后才更新本地团队关系。</p></div>`;
}
function handleOrganizationAction(el) {
  const d=el.dataset,t=team(d.team);if(!d.action?.startsWith('organization-'))return false;
  if(!t){toast('团队不存在。');return true;}
  const draft=organizationDraft(t);
  if(d.action==='organization-select'){draft.selectedId=d.employee;render();return true;}
  if(d.action==='organization-undo'){if(draft.history.length){draft.rows=JSON.parse(draft.history.pop());draft.dirty=JSON.stringify(draft.rows)!==draft.initialRows;render();toast('已撤销一步草稿调整。');}return true;}
  if(d.action==='organization-reset'){state.organizationDrafts[t.id]=organizationNewDraft(t,draft.selectedId);render();toast('已重新读取本团队关系，未保存草稿已放弃。');return true;}
  if(d.action==='organization-save'){organizationSaveDraft(t);return true;}
  return false;
}
function handleOrganizationForm(form) {
  if(form.dataset.form!=='organization-employee')return false;
  const t=team(form.dataset.team);if(!t){toast('团队不存在。');return true;}
  const parentId=document.getElementById(`organization-parent-${t.id}`)?.value;
  const role=document.getElementById(`organization-role-${t.id}`)?.value.trim()||'';
  const result=organizationApplyDraft(t.id,form.dataset.employee,parentId,role);
  if(!result.ok)toast(result.error);else {render();toast(result.changed?'已更新组织草稿，保存后才生效。':'没有新的草稿调整。');}
  return true;
}
function organizationSaveDraft(t) {
  const draft=organizationDraft(t);
  if(draft.baseline!==organizationFingerprint(t))return toast('成员或原始关系已变化，未覆盖新内容。请“重新读取”后调整。');
  const issues=organizationProblems(t,draft.rows);
  if(issues.length)return toast('仍有缺失或循环关系，请修复后再保存。');
  if(!draft.dirty)return toast('没有需要保存的组织调整。');
  for(const p of organizationPeople(t)){p.parentId=draft.rows[p.id].parentId;p.role=draft.rows[p.id].role;}
  t.organizationVersion=(t.organizationVersion||1)+1;
  state.organizationDrafts[t.id]=organizationNewDraft(t,draft.selectedId);render();
  toast('本团队层级已保存 · 本地演示；在途工作采用方式未自动改变');
}
function organizationModal() { return null; }
function organizationDrawer() { return null; }
function bindOrganizationDrag() {
  if(window.__gillOrganizationDragBound)return;
  window.__gillOrganizationDragBound=true;
  document.addEventListener('dragstart',organizationOnDragStart);
  document.addEventListener('dragover',organizationOnDragOver);
  document.addEventListener('dragleave',organizationOnDragLeave);
  document.addEventListener('drop',organizationOnDrop);
  document.addEventListener('dragend',organizationOnDragEnd);
}
function organizationDragPayload(event) {
  if(window.__gillOrganizationDrag)return window.__gillOrganizationDrag;
  try {const raw=event.dataTransfer?.getData('application/x-gill-organization');return raw?JSON.parse(raw):null;}catch{return null;}
}
function organizationClearDropMarks() {
  document.querySelectorAll('.organization-node.drag-over,.organization-node.drag-invalid').forEach(node=>node.classList.remove('drag-over','drag-invalid'));
}
function organizationOnDragStart(event) {
  const node=event.target.closest('[data-org-draggable]');if(!node)return;
  const t=team(node.dataset.orgTeam),p=person(node.dataset.orgEmployee);
  if(!t||!p||p.teamId!==t.id){event.preventDefault();return;}
  const payload={teamId:t.id,employeeId:p.id};window.__gillOrganizationDrag=payload;
  event.dataTransfer?.setData('application/x-gill-organization',JSON.stringify(payload));
  event.dataTransfer?.setData('text/plain',p.name);if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
  node.classList.add('dragging');node.setAttribute('aria-grabbed','true');
}
function organizationDropValidation(payload,node) {
  if(!payload||!node)return {ok:false,error:'无法识别拖拽对象。'};
  if(payload.teamId!==node.dataset.orgTeam)return {ok:false,error:'不能跨团队调整员工或上级。'};
  const t=team(payload.teamId);if(!t)return {ok:false,error:'团队不存在。'};
  return organizationCanParent(t,organizationDraft(t),payload.employeeId,node.dataset.orgEmployee);
}
function organizationOnDragOver(event) {
  const node=event.target.closest('[data-org-drop]'),payload=organizationDragPayload(event);
  if(!node||!payload)return;
  const result=organizationDropValidation(payload,node);organizationClearDropMarks();
  event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect=result.ok?'move':'none';
  node.classList.add(result.ok?'drag-over':'drag-invalid');
}
function organizationOnDragLeave(event) {
  const node=event.target.closest('[data-org-drop]');
  if(node&&!node.contains(event.relatedTarget))node.classList.remove('drag-over','drag-invalid');
}
function organizationOnDrop(event) {
  const node=event.target.closest('[data-org-drop]'),payload=organizationDragPayload(event);if(!node||!payload)return;
  event.preventDefault();const allowed=organizationDropValidation(payload,node);organizationClearDropMarks();
  if(!allowed.ok){toast(allowed.error);organizationOnDragEnd();return;}
  const result=organizationApplyDraft(payload.teamId,payload.employeeId,node.dataset.orgEmployee);
  organizationOnDragEnd();if(!result.ok)return toast(result.error);
  render();toast(result.changed?'已预览新的上下级关系，点击保存层级后生效。':'上下级关系未变化。');
}
function organizationOnDragEnd() {
  window.__gillOrganizationDrag=null;organizationClearDropMarks();
  document.querySelectorAll('.organization-node.dragging').forEach(node=>{node.classList.remove('dragging');node.removeAttribute('aria-grabbed');});
}
