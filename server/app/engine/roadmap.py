"""E1 roadmap pipeline: planner LLM -> validate -> persist DAG."""
import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select

from ..bus import bus
from ..db import engine
from ..llm import client as llm
from ..llm.client import ApiError
from ..mock_data import PLANNER_MOCK
from ..models import Edge, Node, Roadmap

logger = logging.getLogger("studyforge.roadmap")
MAX_RETRY = 3


def topo_order(nodes: List[Dict[str, Any]], edges: List[Dict[str, Any]]) -> Optional[List[str]]:
    """Kahn 拓扑排序；有环返回 None。"""
    keys = [n["key"] for n in nodes]
    indeg = {k: 0 for k in keys}
    adj: Dict[str, List[str]] = {k: [] for k in keys}
    for e in edges:
        adj[e["from"]].append(e["to"])
        indeg[e["to"]] += 1
    queue = [k for k in keys if indeg[k] == 0]
    order: List[str] = []
    while queue:
        k = queue.pop(0)
        order.append(k)
        for nxt in adj[k]:
            indeg[nxt] -= 1
            if indeg[nxt] == 0:
                queue.append(nxt)
    return order if len(order) == len(keys) else None


def validate(data: Dict[str, Any]) -> List[str]:
    errors: List[str] = []
    nodes = data.get("nodes") or []
    edges = data.get("edges") or []
    if not (4 <= len(nodes) <= 15):
        errors.append(f"节点数量 {len(nodes)} 不在 4~15 范围")
    keys = {n.get("key") for n in nodes}
    if len(keys) != len(nodes):
        errors.append("存在重复节点 key")
    for e in edges:
        if e.get("from") not in keys or e.get("to") not in keys:
            errors.append(f"边引用了不存在的节点: {e}")
    if topo_order(nodes, edges) is None:
        errors.append("依赖关系存在环")
    if not edges:
        errors.append("缺少依赖边")
    for n in nodes:
        if not n.get("kp"):
            errors.append(f"节点 {n.get('key')} 缺少细分知识点 kp")
    return errors


async def generate_roadmap(roadmap_id: int) -> None:
    """后台任务：生成 -> 校验循环(≤3) -> 建图 -> 启动内容流水线。"""
    from . import content

    with Session(engine) as session:
        roadmap = session.get(Roadmap, roadmap_id)
        if roadmap is None:
            return
        prompt_tpl = llm.load_prompt("planner")
        prompt = prompt_tpl.format(
            goal=roadmap.goal, base=roadmap.base or "零基础",
            outcome=roadmap.outcome or "掌握基础", time_budget=roadmap.time_budget or "未指定",
        )

    data: Optional[Dict[str, Any]] = None
    reason = ""
    for attempt in range(1, MAX_RETRY + 1):
        try:
            result = await llm.call_json("planner", prompt, mock_payload=PLANNER_MOCK,
                                         mock_delay=3.0, purpose="roadmap", roadmap_id=roadmap_id)
            errors = validate(result)
            if not errors:
                data = result
                break
            reason = "；".join(errors)
            logger.warning("roadmap %s 校验失败(第%d次): %s", roadmap_id, attempt, reason)
            prompt = prompt_tpl.format(
                goal=roadmap.goal, base=roadmap.base or "零基础",
                outcome=roadmap.outcome or "掌握基础", time_budget=roadmap.time_budget or "未指定",
            ) + f"\n\n## 上次输出的问题（务必修正）\n{reason}"
        except ApiError as e:
            reason = str(e)
            if e.is_timeout:
                logger.warning("roadmap %s 模型响应超时(第%d次)，不再重试", roadmap_id, attempt)
                break  # 同样的请求重试只会再超时一次，快速失败
            logger.warning("roadmap %s 生成异常(第%d次): %s", roadmap_id, attempt, reason)
        except Exception as e:  # noqa: BLE001
            reason = str(e)
            logger.warning("roadmap %s 生成异常(第%d次): %s", roadmap_id, attempt, reason)

    if data is None:
        with Session(engine) as session:
            roadmap = session.get(Roadmap, roadmap_id)
            roadmap.status = "failed"
            session.add(roadmap)
            session.commit()
        bus.publish("roadmap.failed", roadmap_id, {"reason": reason})
        return

    nodes_data = data["nodes"]
    edges_data = data["edges"]
    order = topo_order(nodes_data, edges_data) or [n["key"] for n in nodes_data]

    with Session(engine) as session:
        roadmap = session.get(Roadmap, roadmap_id)
        roadmap.outline = [{"key": n["key"], "title": n["title"], "summary": n.get("summary", "")}
                           for n in nodes_data]
        roadmap.status = "learning"
        session.add(roadmap)

        key2node: Dict[str, Node] = {}
        for n in nodes_data:
            node = Node(
                roadmap_id=roadmap_id, ext_key=n["key"], title=n["title"],
                summary=n.get("summary", ""), kp_list=n.get("kp", []),
                est_minutes=n.get("est_minutes", 45), order_index=order.index(n["key"]),
            )
            session.add(node)
            key2node[n["key"]] = node
        session.flush()
        for e in edges_data:
            session.add(Edge(roadmap_id=roadmap_id,
                             from_node=key2node[e["from"]].id, to_node=key2node[e["to"]].id))
        # 入度 0 的节点直接解锁
        targets = {e["to"] for e in edges_data}
        for key, node in key2node.items():
            if key not in targets:
                node.status = "unlocked"
        session.commit()
        bus.publish("roadmap.ready", roadmap_id, {"nodes": len(nodes_data)})

    await content.ensure_pipeline(roadmap_id)


def unlock_successors(session: Session, node_id: int) -> List[int]:
    """节点通过后，检查后继是否所有前驱都已通过 → 解锁。返回新解锁的节点 id。"""
    node = session.get(Node, node_id)
    edges = session.exec(select(Edge).where(Edge.roadmap_id == node.roadmap_id)).all()
    succ_ids = [e.to_node for e in edges if e.from_node == node_id]
    all_nodes = {n.id: n for n in session.exec(
        select(Node).where(Node.roadmap_id == node.roadmap_id)).all()}
    unlocked: List[int] = []
    for sid in succ_ids:
        succ = all_nodes.get(sid)
        if succ is None or succ.status not in ("locked",):
            continue
        preds = [e.from_node for e in edges if e.to_node == sid]
        if all(all_nodes[p].status in ("passed", "mastered") for p in preds if p in all_nodes):
            succ.status = "unlocked"
            session.add(succ)
            unlocked.append(sid)
    return unlocked
