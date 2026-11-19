const views = {
  team: {
    heading: '团队模板', description: '复用流程与角色分工。', name: '从模板创建团队',
    source: '日常交接', content: '确认目标，执行后提供检查依据。交接时写明已完成和待确认事项。',
    effect: '复制流程与「执行」「复核」两个角色。创建后可分别调整。',
  },
  role: {
    heading: '角色模板', description: '复用职责、交付标准和 Skills。', name: '从模板创建角色',
    source: '复核', content: '逐项核对交付依据。给出结论并列出未验证事项。',
    effect: '将角色职责与 Skill 复制到当前团队。',
  },
  member: {
    heading: '员工', description: '为每位员工配置性格和工作方式。', name: '创建员工',
    source: '个人设定', content: '可以按需关联团队角色，并自由填写性格、工作态度和沟通方式。',
    effect: '成员的性格和工作态度独立保存。',
  },
}
const byId = id => document.getElementById(id)
const dialog = byId('editor')
let active = 'team'
document.querySelector('.tabs').addEventListener('click', event => {
  const page = event.target.closest('[data-page]')
  if (!page) return
  active = page.dataset.page
  for (const item of document.querySelectorAll('[data-page]')) item.removeAttribute('aria-current')
  page.setAttribute('aria-current', 'page')
  const view = views[active]
  byId('title').textContent = view.heading
  byId('description').textContent = view.description
  byId('create').textContent = view.name
  byId('record').innerHTML = `<h3>${view.source}</h3><p class="record-content">${view.content}</p>`
})
byId('create').addEventListener('click', () => {
  byId('editor-title').textContent = views[active].name
  byId('effect').textContent = views[active].effect
  byId('form').reset()
  byId('personal').hidden = active !== 'member'
  dialog.showModal()
})
byId('cancel').addEventListener('click', () => dialog.close())
byId('form').addEventListener('submit', event => {
  event.preventDefault()
  const name = byId('name').value.trim()
  if (!name) return
  const details = active === 'team' ? '团队流程、执行角色、复核角色'
    : active === 'role' ? '复核职责与交付标准'
    : [byId('role').value || '未关联角色', byId('personality').value].filter(Boolean).join(' · ')
  byId('result').textContent = `${name}已创建 · ${details}`
  dialog.close()
})
