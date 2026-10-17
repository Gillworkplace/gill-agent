"""知识库（FR-91~99）：沉淀/检索/注入。一期关键词+标签检索（pgvector 接口已留，二期切换）。"""
from __future__ import annotations
import json
import logging
import re
import time
import uuid as _uuid

log = logging.getLogger("gill.kb")

# 显式记忆指令（FR-92）
REMEMBER_RE = re.compile(r"^(?:请)?记住[:：\s]+(.{2,500})$", re.S)
FORGET_RE = re.compile(r"^(?:请)?(?:忘掉|忘记|删除记忆)[:：\s]+(.{1,200})$")

INJECT_TEMPLATE = """[用户知识库]（检索到 {n} 条，按相关度）
{items}
引用规则：使用任一条目时，在回复中自然说明依据（如"按你之前的偏好…"）。"""


class KnowledgeBase:
    EMBED_MODEL = None   # 懒加载 Settings

    def __init__(self, pg_dsn: str, user_id: int, space_id: str | None = None,
                 project_tag: str | None = None, session_id: str | None = None):
        self.dsn, self.uid, self.space_id = pg_dsn, user_id, space_id
        self.project_tag, self.session_id = project_tag, session_id
        self._pool = None

    async def _embed(self, text: str) -> list[float] | None:
        """智谱 embedding-3（BD-9）；失败返回 None（降级关键词）。"""
        try:
            from .config import Settings
            from openai import AsyncOpenAI
            s = Settings()
            client = AsyncOpenAI(api_key=s.zhipu_api_key, base_url=s.zhipu_base_url, timeout=30)
            r = await client.embeddings.create(model=s.embed_model, input=text[:8000])
            return list(r.data[0].embedding)
        except Exception as e:
            log.warning("embed fail (降级关键词): %s", e)
            return None

    async def pool(self):
        if self._pool is None:
            import asyncpg
            self._pool = await asyncpg.create_pool(self.dsn, min_size=1, max_size=4)
        return self._pool

    async def close(self):
        if self._pool:
            await self._pool.close()

    # ---------- 沉淀（FR-91/95：去重=同 scope+type 内 title 相似则更新） ----------
    async def save(self, title: str, content: str, ktype: str = "fact", tags: list[str] | None = None,
                   scope: str = "user", source: str = "auto", confidence: float = 0.8,
                   source_msg_id: int | None = None) -> dict:
        pool = await self.pool()
        tags = tags or []
        sid = self.session_id if scope == "session" else None
        ptag = self.project_tag if scope == "project" else None
        spid = self.space_id if scope in ("user", "group") else None
        # 简化去重：同 scope+type+title 精确匹配 → 更新版本
        async with pool.acquire() as c:
            row = await c.fetchrow(
                """SELECT id, version FROM knowledge_items
                   WHERE COALESCE(project_tag,'')=COALESCE($1,'') AND scope=$2 AND type=$3
                     AND lower(title)=lower($4)
                     AND (session_id IS NOT DISTINCT FROM $5)""",
                ptag, scope, ktype, title, sid)
            if row:
                await c.execute(
                    """UPDATE knowledge_items SET content=$1, tags=$2, confidence=$3,
                       updated_at=now(), version=version+1 WHERE id=$4""",
                    content, tags, confidence, row["id"])
                return {"id": str(row["id"]), "updated": True}
            emb = await self._embed(title + " " + content)
            rid = await c.fetchval(
                """INSERT INTO knowledge_items(id, user_id, space_id, scope, project_tag, session_id,
                     type, title, content, tags, source, source_msg_id, confidence, embedding)
                   VALUES ($13,$1,$2::uuid,$3,$4,$5::uuid,$6,$7,$8,$9,$10,$11,$12,
                           CASE WHEN $14::text IS NULL THEN NULL ELSE $14::vector END) RETURNING id""",
                self.uid, spid, scope, ptag, sid, ktype, title, content, tags,
                source, source_msg_id, confidence, _uuid.uuid4(),
                "[" + ",".join(f"{x}" for x in emb) + "]" if emb else None)
            return {"id": str(rid), "updated": False}

    # ---------- 检索（FR-93/BD-9：向量+关键词混合，优先级 session>project>group>user；pinned 置顶） ----------
    async def search(self, query: str, limit: int = 8) -> list[dict]:
        pool = await self.pool()
        words = [w for w in re.split(r"[\s,，。；;！？!?]+", query) if len(w) >= 2][:8]
        emb = await self._embed(query)
        async with pool.acquire() as c:
            # 语义检索（embedding 命中时）
            sem_rows = []
            if emb:
                vec = "[" + ",".join(str(x) for x in emb) + "]"
                sem_rows = await c.fetch(
                    """SELECT id::text, scope, type, title, content, tags, pinned, hit_count,
                              (CASE scope WHEN 'session' THEN 0 WHEN 'project' THEN 1
                                          WHEN 'group' THEN 2 ELSE 3 END) AS prio,
                              1 - (embedding <=> $1::vector) AS sim
                       FROM knowledge_items
                       WHERE status='active' AND user_id=$2 AND embedding IS NOT NULL
                         AND (scope='user' OR (scope='session' AND session_id=$3::uuid)
                              OR (scope='project' AND project_tag=$4)
                              OR (scope='group' AND space_id=$5::uuid))
                       ORDER BY pinned DESC, sim DESC LIMIT $6""",
                    vec, self.uid, self.session_id, self.project_tag, self.space_id, limit)
            kw_rows = []
            if words:
                kw_rows = await c.fetch(
                    """SELECT id::text, scope, type, title, content, tags, pinned, hit_count,
                              (CASE scope WHEN 'session' THEN 0 WHEN 'project' THEN 1
                                          WHEN 'group' THEN 2 ELSE 3 END) AS prio,
                              (SELECT count(*) FROM unnest($1::text[]) w
                                 WHERE content ILIKE '%' || w || '%'
                                    OR title ILIKE '%' || w || '%')::float AS sim
                       FROM knowledge_items
                       WHERE status='active' AND user_id=$2
                         AND (scope='user' OR (scope='session' AND session_id=$3::uuid)
                              OR (scope='project' AND project_tag=$4)
                              OR (scope='group' AND space_id=$5::uuid))
                         AND EXISTS (SELECT 1 FROM unnest($1::text[]) w
                               WHERE content ILIKE '%' || w || '%'
                                  OR title ILIKE '%' || w || '%'
                                  OR title ILIKE '%' || $6 || '%')
                       ORDER BY pinned DESC, prio, sim DESC LIMIT $7""",
                    words, self.uid, self.session_id, self.project_tag, self.space_id, query, limit)
            # 混合融合（id 去重，语义优先）
            merged: dict[str, dict] = {}
            for r in [*sem_rows, *kw_rows]:
                d = dict(r)
                if d["id"] not in merged:
                    merged[d["id"]] = d
            rows = sorted(merged.values(),
                          key=lambda d: (not d["pinned"], d["prio"], -(d["sim"] or 0)))
            return rows[:limit]

    # ---------- 注入块（FR-93：token 预算截断） ----------
    async def build_injection(self, query: str, max_items: int = 8, max_chars: int = 2000) -> str:
        items = await self.search(query, limit=max_items)
        if not items:
            return ""
        lines, used = [], 0
        for it in items:
            line = f"{it['id']}.（{it['type']}）{it['title']}：{it['content'][:160]}"
            if used + len(line) > max_chars:
                break
            lines.append(line)
            used += len(line)
        if not lines:
            return ""
        return INJECT_TEMPLATE.format(n=len(lines), items="\n".join(lines))

    # ---------- 命中回写（FR-93） ----------
    async def touch(self, ids: list[str]):
        if not ids:
            return
        pool = await self.pool()
        async with pool.acquire() as c:
            await c.execute(
                "UPDATE knowledge_items SET hit_count=hit_count+1, last_used_at=now() "
                "WHERE id = ANY($1::uuid[])", ids)

    async def delete_matching(self, text: str) -> list[dict]:
        pool = await self.pool()
        async with pool.acquire() as c:
            rows = await c.fetch(
                "SELECT id::text, title FROM knowledge_items WHERE user_id=$1 AND status='active' "
                "AND (content ILIKE '%'||$2||'%' OR title ILIKE '%'||$2||'%') LIMIT 10", self.uid, text)
            for r in rows:
                await c.execute("DELETE FROM knowledge_items WHERE id=$1::uuid", r["id"])
            return [dict(r) for r in rows]
