export type ResourceSortOrder = 'name' | 'updated'

type Resource = { id: string; name?: string; title?: string; updatedAt?: string }

const collator = new Intl.Collator('zh-Hans-u-co-pinyin')
const nameOf = (item: Resource) => item.name ?? item.title ?? ''
const updateTime = (item: Resource) => Date.parse(item.updatedAt ?? '') || 0

export function sortResources<T extends Resource>(items: readonly T[], order: ResourceSortOrder): T[] {
 return [...items].sort((a, b) => {
  if (order === 'updated') {
   const byUpdate = updateTime(b) - updateTime(a)
   if (byUpdate) return byUpdate
  }
  return collator.compare(nameOf(a), nameOf(b)) || collator.compare(a.id, b.id)
 })
}
