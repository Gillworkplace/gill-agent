const flow = {
  name: '团队流程',
  revision: 1,
  prompt: '接到工作后确认目标与交付条件。\n需要交接时，附上当前成果、已完成的检查和待确认事项。\n遇到无法自行判断的问题，整理依据后向直属上级上报。',
  files: [
    { path: 'skills/协作交接/SKILL.md', kind: 'Skill' },
    { path: 'references/交接记录.md', kind: '参考文件' },
  ],
}
const roles = [
  {
    id: 'executor', name: '执行', revision: 1,
    prompt: '根据目标选择执行方法，记下关键判断的依据。交接前核对输出是否满足约定。',
    files: [{ path: 'skills/执行检查/SKILL.md', kind: 'Skill' }],
  },
  {
    id: 'reviewer', name: '复核', revision: 1,
    prompt: '按交付条件独立复核。明确区分已验证、未验证与需要补充的内容。',
    files: [{ path: 'skills/复核记录/SKILL.md', kind: 'Skill' }],
  },
]
const members = [
  {
    id: 'a', name: '成员 A', roleId: 'executor', revision: 1,
    prompt: '我在交接前整理附件，并标记其他成员需要阅读的章节。',
    files: [{ path: 'skills/整理附件/SKILL.md', kind: 'Skill' }],
  },
  {
    id: 'b', name: '成员 B', roleId: 'executor', revision: 1,
    prompt: '我会把交接事项整理成一份待核对清单。',
    files: [{ path: 'skills/整理清单/SKILL.md', kind: 'Skill' }],
  },
  {
    id: 'c', name: '成员 C', roleId: 'reviewer', revision: 1,
    prompt: '',
    files: [],
  },
]
const labels = { flow: '团队流程', roles: '团队角色', members: '成员' }
const fileKinds = ['工作指令', 'Skill', '参考文件']
const state = { tab: 'flow', roleId: 'executor', memberId: 'a', preview: 'new', edit: null }
const $ = id => document.getElementById(id)
const template = text => String(text).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char]))
const roleFor = id => roles.find(role => role.id === id)
const memberFor = id => members.find(member => member.id === id)
const adopting = id => members.filter(member => member.roleId === id)
const original = Object.fromEntries(members.map(member => [member.id, structuredClone(getLayers(member))]))
let noticeTimeout

function getLayers(member) {
  return [
    ['flow', flow],
    ['roles', roleFor(member.roleId)],
    ['members', member],
  ]
}

function filesMarkup(files, editable = false) {
  if (!files.length) return '<p class="empty">暂无文件</p>'
  return `<ul class="file-list">${files.map((file, index) => `
    <li class="file-row">
      <code>${template(file.path)}</code>
      ${editable ? `<span class="line actions">
        <select data-file-index="${index}" aria-label="文件用途 ${template(file.path)}">
          ${fileKinds.map(kind => `<option${kind === file.kind ? ' selected' : ''}>${kind}</option>`).join('')}
        </select>
        <button type="button" class="button link" data-remove="${index}" aria-label="移除 ${template(file.path)}">移除</button>
      </span>` : `<span class="file-kind">${template(file.kind)}</span>`}
    </li>`).join('')}</ul>`
}

function recordMarkup(record, scope, relation = '') {
  return `<div class="record">
    <div class="record-meta"><span class="version">v${record.revision}</span><span>${scope}</span></div>
    ${relation}
    <h3>Prompt</h3>
    <p class="record-content">${template(record.prompt || '暂无补充指令')}</p>
    <h3>文件与 Skills</h3>
    ${filesMarkup(record.files)}
  </div>`
}

function renderFlow() {
  $('configuration').innerHTML = `<article class="panel">
    <header class="section-head">
      <div><h2>团队流程</h2><p class="muted">全队共用一份，保存后供新任务采用。</p></div>
      <button type="button" class="button primary" data-edit="flow">编辑流程</button>
    </header>
    ${recordMarkup(flow, `适用于全部 ${members.length} 位成员`)}
  </article>`
}

function renderDirectory(scope) {
  const editingRoles = scope === 'roles'
  const records = editingRoles ? roles : members
  const record = editingRoles ? roleFor(state.roleId) : memberFor(state.memberId)
  const descriptor = item => editingRoles
    ? `${adopting(item.id).length} 位成员`
    : roleFor(item.roleId)?.name ?? '未关联角色'
  const relation = editingRoles
    ? `<div class="adoption"><span class="muted">采用成员</span>
        ${adopting(record.id).map(member => `<button type="button" class="person-pill" data-person="${member.id}">${template(member.name)}</button>`).join('') || '<small class="muted">暂无成员采用</small>'}</div>`
    : `<div class="adoption"><span class="muted">采用角色</span>
        ${record.roleId ? `<button type="button" class="person-pill" data-role="${record.roleId}">${template(descriptor(record))}</button>` : '<span class="role-caption">未关联角色</span>'}</div>`
  $('configuration').innerHTML = `<article class="panel">
    <header class="section-head">
      <div><h2>${labels[scope]}</h2><p class="muted">${editingRoles ? '同一角色的成员共用一套岗位指令。' : '关联角色，并配置成员自己的 Skill。'}</p></div>
      ${editingRoles ? '<button type="button" class="button primary" data-edit="create">新建角色</button>' : ''}
    </header>
    <div class="directory">
      <ul class="directory-list" aria-label="${labels[scope]}列表">
        ${records.map(item => `<li><button type="button" class="item"
          data-${editingRoles ? 'role' : 'person'}="${item.id}"${item.id === record.id ? ' aria-current="true"' : ''}>
          <span class="item-mark mark-${scope}" aria-hidden="true">${template(editingRoles ? item.name[0] : item.name.at(-1))}</span>
          <span class="item-text"><strong>${template(item.name)}</strong><small>${template(descriptor(item))}</small></span>
        </button></li>`).join('')}
      </ul>
      <section class="selection" aria-label="${labels[scope]}详情">
        <header class="section-head">
          <h2>${template(record.name)}</h2>
          <button type="button" class="button secondary" data-edit="${scope}">${editingRoles ? '编辑角色' : '编辑成员配置'}</button>
        </header>
        ${recordMarkup(record, editingRoles ? '角色共用配置' : '个人配置', relation)}
      </section>
    </div>
  </article>`
}

function renderPreview() {
  $('preview-member').innerHTML = members.map(member =>
    `<option value="${member.id}">${template(member.name)}</option>`).join('')
  $('preview-member').value = state.memberId
  $('preview-note').textContent = state.preview === 'new' ? '按当前保存的配置预览。' : '显示示例任务创建时的配置快照。'
  for (const button of $('preview-state').querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', button.dataset.view === state.preview)
  }
  const expanded = new Set([...$('preview-layers').querySelectorAll('details[open]')].map(details => details.dataset.layer))
  const layers = state.preview === 'new' ? getLayers(memberFor(state.memberId)) : original[state.memberId]
  $('preview-layers').innerHTML = layers.map(([scope, record]) => `<details class="layer" data-layer="${scope}"${expanded.has(scope) ? ' open' : ''}>
    <summary>
      <span class="item-mark mark-${scope}" aria-hidden="true">${{ flow: '流', roles: '角', members: '人' }[scope]}</span>
      <span class="item-text">
        <strong>${scope === 'members' ? '个人配置' : labels[scope]}</strong>
        <small>${record ? `${template(scope === 'flow' ? '全队共用' : record.name)} · v${record.revision} · ${record.files.length} 个文件` : '未关联角色'}</small>
      </span>
    </summary>
    <div class="layer-content">
      ${record ? `<p>${template(record.prompt || '暂无补充指令')}</p>${record.files.length ? filesMarkup(record.files) : ''}` : '<p>为成员选择角色后，新任务会采用角色指令。</p>'}
    </div>
  </details>`).join('')
}

function render() {
  for (const button of $('tabs').querySelectorAll('[data-tab]')) {
    if (button.dataset.tab === state.tab) button.setAttribute('aria-current', 'page')
    else button.removeAttribute('aria-current')
  }
  if (state.tab === 'flow') renderFlow()
  else renderDirectory(state.tab)
  renderPreview()
}

function openEditor(scope) {
  const source = { flow, roles: roleFor(state.roleId), members: memberFor(state.memberId) }[scope]
  const draft = source ? structuredClone(source) : { name: '', prompt: '', files: [], revision: 0 }
  const editsRole = scope === 'roles' || scope === 'create'
  state.edit = { scope, source, draft }
  $('dialog-title').textContent = {
    flow: '编辑团队流程', roles: '编辑角色', members: '编辑成员配置', create: '新建团队角色',
  }[scope]
  $('edit-context').textContent = source ? `${source.name} · 当前版本 v${source.revision}` : '创建后可在成员配置中关联。'
  $('name-field').hidden = !editsRole
  $('record-name').required = editsRole
  $('record-name').value = draft.name
  $('role-field').hidden = scope !== 'members'
  $('member-role').innerHTML = '<option value="">暂未关联角色</option>' + roles.map(role =>
    `<option value="${role.id}">${template(role.name)}</option>`).join('')
  $('member-role').value = draft.roleId ?? ''
  $('prompt-text').value = draft.prompt
  $('edit-error').hidden = true
  $('save-effect').textContent = {
    flow: `保存影响全部 ${members.length} 位成员的新任务。`,
    roles: `保存影响 ${source ? adopting(source.id).length : 0} 位采用成员的新任务。`,
    members: '保存仅影响该成员的新任务。',
    create: '成员关联后，新任务才会采用。',
  }[scope]
  renderEditorFiles()
  $('editor').showModal()
  $(editsRole ? 'record-name' : 'prompt-text').focus()
}

function renderEditorFiles() {
  $('edit-files').innerHTML = filesMarkup(state.edit.draft.files, true)
}

function importFolder(files) {
  const draft = state.edit.draft
  const byPath = new Map(draft.files.map(file => [file.path, file]))
  for (const file of files) byPath.set(file.path, byPath.get(file.path) ?? file)
  draft.files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path))
  renderEditorFiles()
}

function toast(text) {
  clearTimeout(noticeTimeout)
  $('notice').textContent = text
  $('notice').hidden = false
  noticeTimeout = setTimeout(() => { $('notice').hidden = true }, 3000)
}

$('tabs').addEventListener('click', event => {
  const button = event.target.closest('[data-tab]')
  if (!button) return
  state.tab = button.dataset.tab
  render()
})

$('configuration').addEventListener('click', event => {
  const button = event.target.closest('button')
  if (!button) return
  if (button.dataset.edit) {
    openEditor(button.dataset.edit)
    return
  }
  if (button.dataset.person) {
    state.memberId = button.dataset.person
    state.tab = 'members'
  } else if (button.dataset.role) {
    state.roleId = button.dataset.role
    state.tab = 'roles'
  } else return
  render()
  const attribute = button.dataset.person ? 'person' : 'role'
  $('configuration').querySelector(`[data-${attribute}][aria-current]`)?.focus()
})

$('preview-member').addEventListener('change', event => {
  state.memberId = event.target.value
  if (state.tab === 'members') renderDirectory('members')
  renderPreview()
})
$('preview-state').addEventListener('click', event => {
  const view = event.target.closest('[data-view]')?.dataset.view
  if (!view) return
  state.preview = view
  renderPreview()
})

for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => $('editor').close())
}
$('editor').addEventListener('close', () => {
  if (!$('editor').open) state.edit = null
})
$('import-button').addEventListener('click', () => $('folder').click())
$('sample-folder').addEventListener('click', () => importFolder([
  { path: 'skills/配置示例/SKILL.md', kind: 'Skill' },
  { path: 'skills/配置示例/references/example.md', kind: '参考文件' },
]))
$('folder').addEventListener('change', event => {
  const selection = [...event.target.files]
  const paths = selection.filter(file => !['.DS_Store', 'Thumbs.db'].includes(file.name)).map(file => ({
    path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name,
    kind: /^SKILL\.md$/i.test(file.name) ? 'Skill' : '参考文件',
  }))
  if (paths.length) importFolder(paths)
  event.target.value = ''
})
$('edit-files').addEventListener('change', event => {
  const index = event.target.dataset.fileIndex
  if (index !== undefined) state.edit.draft.files[index].kind = event.target.value
})
$('edit-files').addEventListener('click', event => {
  const index = event.target.closest('[data-remove]')?.dataset.remove
  if (index === undefined) return
  state.edit.draft.files.splice(Number(index), 1)
  renderEditorFiles()
})

$('edit-form').addEventListener('submit', event => {
  event.preventDefault()
  const { scope, source, draft } = state.edit
  if (scope === 'roles' || scope === 'create') {
    draft.name = $('record-name').value.trim()
    if (!draft.name || roles.some(role => role !== source && role.name === draft.name)) {
      $('edit-error').textContent = draft.name ? '该角色名称已存在。' : '请输入角色名称。'
      $('edit-error').hidden = false
      $('record-name').focus()
      return
    }
  }
  if (scope === 'members') draft.roleId = $('member-role').value
  draft.prompt = $('prompt-text').value.trim()
  draft.revision += 1
  if (source) Object.assign(source, draft)
  else {
    draft.id = `role-${roles.length + 1}`
    roles.push(draft)
    state.roleId = draft.id
  }
  $('editor').close()
  render()
  $('configuration').querySelector(`[data-edit="${scope === 'create' ? 'roles' : scope}"]`)?.focus()
  toast(`已保存 ${draft.name} v${draft.revision}`)
})

render()
