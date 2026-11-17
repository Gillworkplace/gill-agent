'use strict';

// Isolated interaction demo: template revisions do not run a model or change active work.
function initTemplateEvolution() {
  state.templates.forEach(tpl => {
    if (!Array.isArray(tpl.history)) tpl.history = [];
    if (!tpl.history.some(item => item.number === tpl.version)) recordTemplateRevision(tpl, 'user', 'user', '建立模板版本记录');
  });
}
function recordTemplateRevision(tpl, actorType, actorId, reason) {
  if (!Array.isArray(tpl.history)) tpl.history = [];
  const existing = tpl.history.find(item => item.number === tpl.version);
  if (existing) return existing;
  const skills = Object.freeze(structuredClone(tpl.skills || []).map(item => Object.freeze(item)));
  const revision = Object.freeze({
    number: tpl.version, name: tpl.name, prompt: tpl.prompt, skills,
    actorType, actorId, actorName: actorType === 'employee' ? person(actorId)?.name || '数字员工' : '我',
    reason: reason || '更新模板', recordedAt: '演示记录',
  });
  tpl.history.push(revision);
  return revision;
}
function templateEvolutionActions(tpl) {
  const attrs = `data-template="${esc(tpl.id)}"`;
  return `${button(`${icon('clock')} 版本记录`, 'template-evolution-history', 'secondary', attrs)}${button(`${icon('spark')} 自迭代演示`, 'template-evolution-open', 'secondary', attrs)}`;
}
function templateEvolutionPeople(tpl) {
  return state.people.filter(employee => employee.templateId === tpl.id);
}
function templateEvolutionModal(m) {
  if (m?.type !== 'template-evolution-edit') return null;
  const tpl = template(m.templateId);
  if (!tpl) return {title: '模板不存在', body: '请返回数字员工模板。', foot: button('关闭', 'close')};
  const people = templateEvolutionPeople(tpl);
  if (!people.length) return {
    kicker: '员工自迭代 · 本地演示', title: '先为团队创建员工',
    body: '<p>这份模板还没有创建实际员工。本次演示从使用该模板的员工中选择记录来源；你可以先为团队创建一位员工。</p><p class="demo-note">这是本次演示的来源选择方式，不将它规定为所有模板迭代的权限规则。</p>',
    foot: `${button('关闭', 'close')}<a class="btn primary" href="#/template/${esc(tpl.id)}">返回模板</a>`,
  };
  return {
    kicker: `${esc(tpl.name)} · 当前 v${tpl.version}`, title: '员工自迭代演示',
    body: `<div class="evolution-notice notice info">员工可以迭代模板的工作 Prompt 与 Skills。这里手工输入模拟结果，未运行真实模型；保存不改知识库、组织关系或现有工作快照。</div><form id="template-evolution-form" data-form="template-evolution-save" data-template="${esc(tpl.id)}" data-version="${tpl.version}"><div class="field"><label class="field-label" for="template-evolution-employee">本轮演示员工</label><select class="select" id="template-evolution-employee">${people.map(employee => `<option value="${esc(employee.id)}">${esc(employee.name)} · ${esc(employee.role)}</option>`).join('')}</select></div><div class="field"><label class="field-label" for="template-evolution-reason">为什么需要迭代</label><textarea class="input" id="template-evolution-reason" rows="2" placeholder="例如：核查中发现口径容易遗漏，补充检查方法。"></textarea></div><div class="field"><label class="field-label" for="template-evolution-prompt">迭代后的工作 Prompt</label><textarea class="input" id="template-evolution-prompt" rows="7">${esc(tpl.prompt)}</textarea></div><h3>迭代现有 Skills</h3><div class="evolution-skill-list">${tpl.skills.map(templateEvolutionSkillEditor).join('') || '<p class="muted small">当前没有 Skill，可以在下方补充。</p>'}</div><div class="evolution-skill-editor"><h3>可选：新增一个 Skill</h3><div class="field"><label class="field-label" for="template-evolution-new-skill-name">能力名称</label><input class="input" id="template-evolution-new-skill-name" placeholder="无需新增时留空"></div><div class="field"><label class="field-label" for="template-evolution-new-skill-content">工作方法</label><textarea class="input" id="template-evolution-new-skill-content" rows="3"></textarea></div></div><div class="evolution-error" id="template-evolution-error" role="alert"></div></form><p class="demo-note">新版本对使用该模板的员工可见；既有员工或正在进行的工作何时采用新版仍待确定。此按钮用于演示，不代表实际自迭代需要逐次人工审批。</p>`,
    foot: `${button('取消', 'close')}<button class="btn primary" type="submit" form="template-evolution-form">模拟员工保存新版本</button>`,
  };
}
function templateEvolutionSkillEditor(item) {
  return `<fieldset class="evolution-skill-editor" data-evolution-skill="${esc(item.id)}"><legend>${esc(item.name)}</legend><div class="field"><label class="field-label">Skill 名称</label><input class="input" data-evolution-field="name" aria-label="Skill 名称" value="${esc(item.name)}"></div><div class="field"><label class="field-label">用途</label><input class="input" data-evolution-field="description" aria-label="Skill 用途" value="${esc(item.description)}"></div><div class="field"><label class="field-label">工作方法</label><textarea class="input" data-evolution-field="content" aria-label="Skill 工作方法" rows="4">${esc(item.content)}</textarea></div></fieldset>`;
}
function templateEvolutionDrawer(d) {
  if (d?.type !== 'template-evolution-history') return null;
  const tpl = template(d.templateId);
  if (!tpl) return {title: '模板不存在', body: '请返回数字员工模板。', foot: button('关闭', 'close')};
  const history = tpl.history || [];
  const revision = history.find(item => item.number === Number(d.version)) || history.at(-1);
  if (!revision) return {title: '尚无版本记录', body: '模板初始化后可查看历史。', foot: button('关闭', 'close')};
  return {
    kicker: '模板版本记录 · 本地演示', title: `${esc(tpl.name)} · v${revision.number}`,
    body: `<div class="evolution-meta"><span class="badge ${revision.actorType === 'employee' ? 'blue' : 'muted'}">${revision.actorType === 'employee' ? '员工自迭代' : '用户维护'}</span><span>${esc(revision.actorName)} · ${esc(revision.recordedAt)}</span></div><p class="evolution-source">${esc(revision.reason)}</p><div class="evolution-preview"><h3>工作 Prompt</h3><pre>${esc(revision.prompt)}</pre><h3>Skills · ${revision.skills.length} 项</h3>${revision.skills.map(item => `<section><b>${esc(item.name)}</b><p class="muted small">${esc(item.description)}</p><pre>${esc(item.content)}</pre></section>`).join('') || '<p class="muted small">此版本没有 Skill。</p>'}</div><h3>全部版本</h3><div class="evolution-history">${[...history].reverse().map(item => `<button class="evolution-version ${item.number === revision.number ? 'active' : ''}" data-action="template-evolution-version" data-template="${esc(tpl.id)}" data-version="${item.number}"><span><b>v${item.number}</b> · ${esc(item.actorName)} · ${item.actorType === 'employee' ? '员工自迭代' : '用户维护'}</span><small>${esc(item.reason)}</small></button>`).join('')}</div><p class="demo-note">这里展示模板历史快照，不证明现有员工或在途工作已经使用该版本。</p>`,
    foot: button('关闭', 'close'),
  };
}
function handleTemplateEvolutionAction(el) {
  const data = el.dataset;
  if (data.action === 'template-evolution-open') {
    openModal('template-evolution-edit', {templateId: data.template});
    return true;
  }
  if (data.action === 'template-evolution-history' || data.action === 'template-evolution-version') {
    openDrawer('template-evolution-history', {templateId: data.template, version: Number(data.version) || undefined});
    return true;
  }
  return false;
}
function handleTemplateEvolutionForm(form) {
  if (form.dataset.form !== 'template-evolution-save') return false;
  saveTemplateEvolution(form);
  return true;
}
function templateEvolutionError(message) {
  const target = document.getElementById('template-evolution-error');
  if (target) target.textContent = message;
  else toast(message);
}
function collectTemplateEvolutionSkills(form) {
  const skills = [...form.querySelectorAll('[data-evolution-skill]')].map(editor => ({
    id: editor.dataset.evolutionSkill,
    name: editor.querySelector('[data-evolution-field="name"]').value.trim(),
    description: editor.querySelector('[data-evolution-field="description"]').value.trim(),
    content: editor.querySelector('[data-evolution-field="content"]').value.trim(),
  }));
  if (skills.some(item => !item.name || !item.content)) return {error: '请填写现有 Skill 的名称与工作方法。'};
  const name = value('template-evolution-new-skill-name'), content = value('template-evolution-new-skill-content');
  if (Boolean(name) !== Boolean(content)) return {error: '新增 Skill 时，请同时填写名称与工作方法。'};
  if (name && content) skills.push({id: `evolved-${Date.now()}-${skills.length}`, name, description: '来自员工本轮自迭代。', content});
  return {skills};
}
function saveTemplateEvolution(form) {
  const collected = collectTemplateEvolutionSkills(form);
  if (collected.error) return templateEvolutionError(collected.error);
  const result = applyTemplateEvolution(form.dataset.template, Number(form.dataset.version), value('template-evolution-employee'), {
    prompt: value('template-evolution-prompt'), reason: value('template-evolution-reason'), skills: collected.skills,
  });
  if (!result.ok) return templateEvolutionError(result.message);
  closeOverlay();render();
  toast(`员工自迭代已记录为模板 v${result.revision.number}；实际工作采用版本待定 · 演示`);
}
function applyTemplateEvolution(templateId, baseVersion, employeeId, changes) {
  const tpl = template(templateId), employee = person(employeeId);
  if (!tpl || !employee || employee.templateId !== tpl.id) return {ok: false, message: '请为本次演示选择使用该模板的员工。'};
  if (tpl.version !== baseVersion) return {ok: false, message: `模板已更新至 v${tpl.version}，本次没有覆盖；请重新打开最新版本。`};
  if (!changes.prompt || !changes.reason) return {ok: false, message: '请填写变更理由与迭代后的工作 Prompt。'};
  if (!Array.isArray(changes.skills) || changes.skills.some(item => !item.id || !item.name || !item.content)) return {ok: false, message: '请提供完整的 Skill 名称与工作方法。'};
  if (!Array.isArray(tpl.history) || !tpl.history.some(item => item.number === tpl.version)) recordTemplateRevision(tpl, 'user', 'user', '迭代前的模板版本');
  tpl.prompt = changes.prompt;
  tpl.skills = structuredClone(changes.skills);
  tpl.version++;
  const revision = recordTemplateRevision(tpl, 'employee', employeeId, changes.reason);
  return {ok: true, revision};
}
