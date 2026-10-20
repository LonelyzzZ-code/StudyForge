"""E2 content pipeline (full): persistent task queue + embedding QC + variants."""
import asyncio
import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from ..bus import bus
from ..db import engine
from ..domain.profiles import get_profile
from ..llm import client as llm
from ..mock_data import PACKAGES_MOCK, fallback_package, make_variant_mock
from ..models import Edge, GenTask, Node, NodePackage, Question, Roadmap
from ..qc import embedding

logger = logging.getLogger("studyforge.content")

_pipeline_tasks: Dict[int, "asyncio.Task[None]"] = {}
GEN_RETRY = 2
PRIO_BG = 0      # package 后台
PRIO_FG = 10     # section 前台（用户在等）


# ---------- 队列 ----------

def enqueue(session: Session, roadmap_id: int, task_type: str, payload: Dict[str, Any],
            priority: int = PRIO_BG) -> None:
    session.add(GenTask(roadmap_id=roadmap_id, task_type=task_type,
                        payload=payload, priority=priority))
    session.commit()


def recover_tasks() -> None:
    """崩溃恢复：running -> pending。"""
    with Session(engine) as session:
        running = session.exec(select(GenTask).where(GenTask.status == "running")).all()
        for t in running:
            t.status = "pending"
            t.attempt_no += 1
            session.add(t)
        if running:
            session.commit()
            logger.info("崩溃恢复：重置 %d 个任务", len(running))


def purge_stale_generating() -> None:
    """清掉进程被杀时遗留的 generating 僵尸内容包（启动时不可能有真正在跑的生成）。"""
    with Session(engine) as session:
        stale = session.exec(select(NodePackage).where(
            NodePackage.status == "generating")).all()
        for p in stale:
            session.delete(p)
        if stale:
            session.commit()
            logger.info("清理 %d 个遗留的 generating 内容包", len(stale))


def resume_pending_pipelines() -> None:
    """重启恢复：为仍有 pending 任务的路线重新拉起流水线 worker（须在事件循环内调用）。"""
    with Session(engine) as session:
        rids = session.exec(select(GenTask.roadmap_id).where(
            GenTask.status == "pending").distinct()).all()
    for rid in rids:
        logger.info("恢复路线 %s 的待处理生成任务", rid)
        asyncio.create_task(ensure_pipeline(rid))


def void_roadmap_tasks(roadmap_id: int) -> None:
    with Session(engine) as session:
        for t in session.exec(select(GenTask).where(
                GenTask.roadmap_id == roadmap_id,
                GenTask.status.in_(("pending", "running")))).all():
            t.status = "void"
            session.add(t)
        session.commit()


async def ensure_pipeline(roadmap_id: int) -> None:
    """启动（或重启）该路线的 worker；已在运行则跳过。"""
    task = _pipeline_tasks.get(roadmap_id)
    if task is not None and not task.done():
        return
    _refill_window(roadmap_id)
    _pipeline_tasks[roadmap_id] = asyncio.get_event_loop().create_task(_run(roadmap_id))


def schedule_refill(roadmap_id: int) -> None:
    """同步上下文入口：节点通过后补充就绪窗口。"""
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        return
    if loop.is_running():
        loop.create_task(ensure_pipeline(roadmap_id))


def _refill_window(roadmap_id: int) -> None:
    """把拓扑序中最靠前的、无 ready 内容包的 ≤window 个节点入队。"""
    window = get_profile("code").get("ready_window", 3)
    with Session(engine) as session:
        nodes = session.exec(select(Node).where(
            Node.roadmap_id == roadmap_id, Node.status != "deleted")).all()
        nodes.sort(key=lambda n: n.order_index)
        has_pkg: Dict[int, str] = {}
        for pkg in session.exec(select(NodePackage).order_by(NodePackage.id.desc())).all():
            if pkg.status in ("ready", "suspect") and pkg.node_id not in has_pkg:
                has_pkg[pkg.node_id] = pkg.status
        queued = {t.payload.get("node_id") for t in session.exec(
            select(GenTask).where(GenTask.roadmap_id == roadmap_id,
                                  GenTask.status.in_(("pending", "running")))).all()}
        pending = [n for n in nodes if n.id not in has_pkg and n.id not in queued]
        for n in pending[:window]:
            enqueue(session, roadmap_id, "package", {"node_id": n.id}, PRIO_BG)


async def _run(roadmap_id: int) -> None:
    while True:
        with Session(engine) as session:
            task = session.exec(select(GenTask).where(
                GenTask.roadmap_id == roadmap_id, GenTask.status == "pending")
                .order_by(GenTask.priority.desc(), GenTask.id)).first()
        if task is None:
            return
        task_id = task.id
        task_type = task.task_type
        payload = dict(task.payload or {})
        with Session(engine) as session:
            t = session.get(GenTask, task_id)
            t.status = "running"
            session.add(t)
            session.commit()
        error = ""
        try:
            if task_type == "package":
                await _generate_one(roadmap_id, payload.get("node_id"))
            elif task_type == "section":
                await regenerate_section(
                    payload.get("node_id"), payload.get("section_index"),
                    roadmap_id=roadmap_id)
        except Exception as e:  # noqa: BLE001
            error = str(e)
            logger.exception("任务 %s(%s) 执行失败", task_id, task_type)
        with Session(engine) as session:
            t = session.get(GenTask, task_id)
            t.status = "done"
            t.error = error[:500]
            t.updated_at = datetime.utcnow()
            session.add(t)
            session.commit()
        _refill_window(roadmap_id)


# ---------- package 生成（含质检） ----------

async def _generate_one(roadmap_id: int, node_id: int) -> None:
    with Session(engine) as session:
        node = session.get(Node, node_id)
        roadmap = session.get(Roadmap, roadmap_id)
        if node is None or roadmap is None:
            return

        pkg = NodePackage(node_id=node_id, status="generating")
        session.add(pkg)
        session.commit()
        session.refresh(pkg)
        pkg_id = pkg.id  # commit 后对象过期，先取出 id 供后续 session 使用
        bus.publish("node.package", roadmap_id, {
            "node_id": node_id, "ext_key": node.ext_key, "package_status": "generating"})

        # 上下文（03 规则：大纲静态 + 直接前驱摘要一次成型，优先级裁剪）
        outline_text = "\n".join(
            f"- {o['key']} {o['title']}：{o['summary']}" for o in roadmap.outline)
        edges = session.exec(select(Edge).where(Edge.roadmap_id == roadmap_id)).all()
        pred_ids = [e.from_node for e in edges if e.to_node == node_id]
        prev_summaries = ""
        if pred_ids:
            prev_pkgs = session.exec(select(NodePackage).where(
                NodePackage.node_id.in_(pred_ids))).all()
            prev_summaries = "\n".join(p.summary for p in prev_pkgs if p.summary)
        if not prev_summaries:
            prev_summaries = "（无，本节点是起点）"

        parts = [
            (4, outline_text), (3, prev_summaries),
            (2, f"节点：{node.title}。知识点：{'、'.join(node.kp_list)}"),
            (1, "讲义结构：概念引入 → 要点讲解 → 示例与练习"),
        ]
        kept = llm.trim_context(parts, max_chars=14000)
        by_pri = {pri: text for pri, text in kept}
        prompt = llm.load_prompt("generator").format(
            goal=roadmap.goal,
            outline=by_pri.get(4, outline_text[:3000]),
            node_title=node.title, node_summary=node.summary,
            kp_list="、".join(node.kp_list),
            prev_summaries=by_pri.get(3, "（已按预算截断）"))
        node_ctx = {"key": node.ext_key, "title": node.title,
                    "summary": node.summary, "kp": node.kp_list}
        mock_payload = PACKAGES_MOCK.get(node.ext_key) or fallback_package(node_ctx)

    data: Optional[Dict[str, Any]] = None
    reason = ""
    for attempt in range(1, GEN_RETRY + 1):
        try:
            result = await llm.call_json("generator", prompt, mock_payload=mock_payload,
                                         mock_delay=2.5, purpose="package",
                                         roadmap_id=roadmap_id)
            prev_sum_text = prev_summaries if prev_summaries != "（无，本节点是起点）" else ""
            # embedding 首次使用会同步下载/加载模型，必须放线程池，否则阻塞事件循环
            problems = await asyncio.to_thread(_check, result, prev_sum_text)
            if not problems:
                data = result
                break
            reason = "；".join(problems)
            logger.warning("node %s 内容质检失败(第%d次): %s", node_id, attempt, reason)
            prompt += f"\n\n## 上次输出的问题（务必修正）\n{reason}"
        except Exception as e:  # noqa: BLE001
            reason = str(e)
            logger.warning("node %s 内容生成异常(第%d次): %s", node_id, attempt, reason)

    if data is not None:
        status = "ready"
    elif llm.mock_mode("generator"):
        # 演示模式（未配 key）：用内置示例内容兜底
        data = mock_payload if isinstance(mock_payload, dict) else fallback_package(node_ctx)
        status = "suspect"
    else:
        # 真实模式生成失败：明示失败供用户重试，不用演示数据冒充模型产出
        status = "failed"

    with Session(engine) as session:
        pkg = session.get(NodePackage, pkg_id)
        pkg.status = status
        if data is not None:
            pkg.lecture = data.get("lecture", {})
            pkg.summary = data.get("summary", "")
            pkg.practice = data.get("practice", {})
            session.add(pkg)
            session.flush()
            for q in data.get("questions", []):
                session.add(Question(
                    package_id=pkg.id, node_id=node_id, tier=q.get("tier", "concept"),
                    qtype=q.get("qtype", "choice"), stem=q.get("stem", ""),
                    options=q.get("options", []), answer=q.get("answer"),
                    kp_tags=q.get("kp_tags", []), skill=q.get("skill", "记忆"),
                    difficulty=q.get("difficulty", 1),
                    std_answer=q.get("std_answer", ""), key_points=q.get("key_points", [])))
        session.commit()
        node = session.get(Node, node_id)
        bus.publish("node.package", roadmap_id, {
            "node_id": node_id, "ext_key": node.ext_key, "package_status": status,
            **({"reason": reason} if status in ("suspect", "failed") else {})})


def _check(data: Dict[str, Any], prev_summaries: str = "") -> List[str]:
    """质检：结构完整性 + 与前序的 embedding 重复度。"""
    problems: List[str] = []
    sections = (data.get("lecture") or {}).get("sections") or []
    if not sections:
        problems.append("讲义缺少 sections")
    questions = data.get("questions") or []
    tiers = {q.get("tier") for q in questions}
    if "concept" not in tiers or "basic" not in tiers:
        problems.append("题库必须同时包含 concept 与 basic 两档")
    for i, q in enumerate(questions):
        if q.get("qtype") == "choice" and len(q.get("options") or []) < 2:
            problems.append(f"第{i+1}题选择题选项不足")
        if q.get("qtype") == "short" and not q.get("key_points"):
            problems.append(f"第{i+1}题简答题缺少关键点清单")
        if not q.get("kp_tags"):
            problems.append(f"第{i+1}题缺少 kp_tags 标签")
    if not problems and prev_summaries and data.get("summary"):
        try:
            if embedding.similarity(data["summary"], prev_summaries) > embedding.DUP_SIM_THRESHOLD:
                problems.append("摘要与直接前序内容重复度过高（embedding > 0.90），请换个角度展开本节点")
        except Exception as e:  # noqa: BLE001  embedding 不可用时跳过该项
            logger.info("embedding 质检跳过: %s", e)
    return problems


# ---------- 变式题（generator 子模式，同步返回） ----------

def _roadmap_goal(roadmap_id: Optional[int]) -> str:
    """取路线学习目标（作为内容主题约束传给各生成 prompt）。"""
    if not roadmap_id:
        return "（未知）"
    with Session(engine) as session:
        roadmap = session.get(Roadmap, roadmap_id)
        return roadmap.goal if roadmap else "（未知）"


async def generate_variant(q: Question, roadmap_id: int) -> Dict[str, Any]:
    """为错题修复后的检验生成变式题；相似度须落在区间内，越界重试 ≤2。"""
    mock_payload = make_variant_mock({
        "tier": q.tier, "qtype": q.qtype, "stem": q.stem, "options": q.options,
        "answer": q.answer, "kp_tags": q.kp_tags, "difficulty": q.difficulty,
        "std_answer": q.std_answer, "key_points": q.key_points,
    })
    prompt = llm.load_prompt("variant").format(
        goal=_roadmap_goal(roadmap_id),
        stem=q.stem, kp_tags="、".join(q.kp_tags), tier=q.tier, qtype=q.qtype,
        difficulty=q.difficulty)

    result: Optional[Dict[str, Any]] = None
    for attempt in range(3):
        try:
            data = await llm.call_json("generator", prompt, mock_payload=mock_payload,
                                       mock_delay=1.5, purpose="variant", roadmap_id=roadmap_id)
        except Exception as e:  # noqa: BLE001
            logger.warning("变式题生成失败(第%d次): %s", attempt + 1, e)
            break
        if not data.get("stem") or not data.get("kp_tags"):
            prompt += "\n\n## 上次输出问题\n缺少 stem 或 kp_tags，请补全。"
            continue
        try:
            sim = await asyncio.to_thread(embedding.similarity, data["stem"], q.stem)
            if embedding.variant_in_bounds(sim):
                data["_similarity"] = round(sim, 3)
                result = data
                break
            prompt += (f"\n\n## 上次输出问题\n与原题相似度 {sim:.2f} 越界"
                       f"（要求 {embedding.VARIANT_SIM_BOUNDS[0]}~{embedding.VARIANT_SIM_BOUNDS[1]}），"
                       + ("太相似，请换情境。" if sim > embedding.VARIANT_SIM_BOUNDS[1]
                          else "偏离考点，请紧扣原考点。"))
        except Exception as e:  # noqa: BLE001
            logger.info("变式题相似度校验跳过: %s", e)
            result = data
            break

    if result is None:
        if llm.mock_mode("generator"):
            result = mock_payload
        else:
            raise RuntimeError("变式题生成失败（模型未产出合格题目），请稍后重试")

    data = result
    # 入库（is_variant 标记，供防背题重测复用）
    with Session(engine) as session:
        vq = Question(
            package_id=q.package_id, node_id=q.node_id, tier=q.tier, qtype=q.qtype,
            stem=data["stem"], options=data.get("options", []),
            answer=data.get("answer"), kp_tags=data.get("kp_tags", q.kp_tags),
            skill=data.get("skill", "理解"), difficulty=data.get("difficulty", q.difficulty),
            std_answer=data.get("std_answer", q.std_answer),
            key_points=data.get("key_points", q.key_points), is_variant=True, variant_of_id=q.id)
        session.add(vq)
        session.commit()
        return {
            "id": vq.id, "tier": vq.tier, "qtype": vq.qtype, "stem": vq.stem,
            "options": vq.options, "kp_tags": vq.kp_tags, "skill": vq.skill,
            "difficulty": vq.difficulty, "is_variant": True, "variant_of": q.id,
            **({"_similarity": data["_similarity"]} if "_similarity" in data else {}),
        }


# ---------- 段落重生成（「这段没懂」） ----------

async def regenerate_section(node_id: int, section_index: int,
                             roadmap_id: Optional[int] = None) -> Dict[str, Any]:
    with Session(engine) as session:
        node = session.get(Node, node_id)
        pkg = session.exec(select(NodePackage).where(
            NodePackage.node_id == node_id).order_by(NodePackage.id.desc())).first()
        if node is None or pkg is None or not pkg.lecture.get("sections"):
            raise ValueError("内容未就绪，无法重生成段落")
        sections = pkg.lecture["sections"]
        if not (0 <= section_index < len(sections)):
            raise ValueError("段落序号越界")
        sec = sections[section_index]
        pkg_id = pkg.id
        rid = roadmap_id or node.roadmap_id

    prompt = llm.load_prompt("section").format(
        goal=_roadmap_goal(rid),
        node_title=node.title, section_title=sec["title"], section_content=sec["content"])
    mock_payload = {
        "title": sec["title"],
        "content": (f"**换个角度理解。**\n\n"
                    f"{sec['content']}\n\n"
                    f"**一句话总结**：先说清它解决什么问题，再看怎么用，最后自己改例子验证。"),
    }
    try:
        data = await llm.call_json("generator", prompt, mock_payload=mock_payload,
                                   mock_delay=1.5, purpose="section", roadmap_id=rid)
    except Exception as e:  # noqa: BLE001
        if llm.mock_mode("generator"):
            data = mock_payload
        else:
            # 真实模式失败直接抛给前端，不用模板冒充重写结果（多次 fallback 会叠加重复段落）
            raise RuntimeError(f"模型重写失败：{e}") from e

    with Session(engine) as session:
        pkg = session.get(NodePackage, pkg_id)
        sections = list(pkg.lecture["sections"])
        sections[section_index] = {"title": data.get("title", sec["title"]),
                                   "content": data.get("content", "")}
        pkg.lecture = {**pkg.lecture, "sections": sections}
        pkg.version += 1
        session.add(pkg)
        session.commit()
        node = session.get(Node, node_id)
        bus.publish("node.package", rid, {
            "node_id": node_id, "ext_key": node.ext_key,
            "package_status": pkg.status, "section_updated": section_index})
    return {"section_index": section_index, "title": data.get("title", sec["title"]),
            "version": pkg.version}
