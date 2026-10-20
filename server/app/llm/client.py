"""LLM access layer (E5-L1, full version).

- 每环节(role)独立读 settings；未配置 → 演示模式(mock)
- 流式接收(推理模型友好)；降级链: JSON mode → 裸提示词(内嵌 schema) + 解析失败重试(≤2)
- 429/5xx/连接错误指数退避重试(3)；其余 4xx 与读超时不重试
- 上下文预算裁剪(按优先级截断)；token 记账(llm_call 表，成功/失败均记录)
"""
import asyncio
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from sqlmodel import Session

from ..db import engine
from ..models import LlmCall, Settings

logger = logging.getLogger("studyforge.llm")
PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"
ROLES = ("planner", "generator", "grader", "assistant")

RETRY_ON_STATUS = 3
JSON_PARSE_RETRY = 2

# 连接 10s / 单块读取 300s：推理模型思考期长，流式下每个 chunk 都会重置读超时
API_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=30.0, pool=30.0)


class ApiError(RuntimeError):
    """上游 API 调用失败。status=HTTP 状态码；is_timeout=网络超时/中断（重试无意义）。"""

    def __init__(self, msg: str, status: Optional[int] = None, is_timeout: bool = False):
        super().__init__(msg)
        self.status = status
        self.is_timeout = is_timeout


def load_prompt(name: str) -> str:
    return (PROMPTS_DIR / f"{name}.txt").read_text(encoding="utf-8")


def _raw_role_cfg(role: str) -> Dict[str, Any]:
    with Session(engine) as session:
        settings = session.get(Settings, 1)
        if not settings:
            return {}
        return dict(getattr(settings, f"{role}_cfg") or {})


def get_role_cfg(role: str) -> Dict[str, Any]:
    """assistant 未单独配置时继承 generator（02 设计决策 #12）。"""
    cfg = _raw_role_cfg(role)
    if role == "assistant" and not is_configured(cfg):
        cfg = _raw_role_cfg("generator")
    return cfg


def is_configured(cfg: Dict[str, Any]) -> bool:
    return bool(cfg.get("base_url") and cfg.get("api_key") and cfg.get("model"))


def mock_mode(role: str) -> bool:
    return not is_configured(get_role_cfg(role))


# ---------- 上下文预算裁剪 ----------
# parts: (优先级小者先截断, 文本)；调用方按 03 规则排序：节点定义 > 模板 > 前序摘要 > 全局大纲

def trim_context(parts: List[Tuple[int, str]], max_chars: int) -> List[Tuple[int, str]]:
    """按优先级保留上下文片段：低优先级片段从尾部截断，超预算整体丢弃。"""
    total = sum(len(t) for _, t in parts)
    if total <= max_chars:
        return parts
    ordered = sorted(parts, key=lambda p: p[0], reverse=True)  # 高优先级在前
    kept: List[Tuple[int, str]] = []
    used = 0
    for pri, text in ordered:
        remain = max_chars - used
        if remain <= 200:
            break
        if len(text) <= remain:
            kept.append((pri, text))
            used += len(text)
        else:
            kept.append((pri, text[:remain] + "\n…(已按上下文预算截断)"))
            used += remain
    logger.info("上下文裁剪: %d -> %d chars, 保留 %d/%d 段", total, used, len(kept), len(parts))
    return kept


# ---------- 记账 ----------

def _estimate_tokens(text: str) -> int:
    """无 usage 时的估算：中文 ≈0.6 token/字，英文/代码/转义 ≈4 字符/token。

    DeepSeek 流式不返回 usage，一刀切 len//3 会对英文/JSON 为主的输出高估 ~1/3。
    """
    if not text:
        return 0
    cjk = sum(1 for ch in text if '\u4e00' <= ch <= '\u9fff')
    return max(1, int(cjk * 0.6 + (len(text) - cjk) / 4))


def _record_call(role: str, purpose: str, model: str, prompt: str, content: str,
                 latency_ms: int, status: str, roadmap_id: Optional[int] = None,
                 usage: Optional[Dict[str, int]] = None) -> None:
    try:
        with Session(engine) as session:
            pt = (usage or {}).get("prompt_tokens") or _estimate_tokens(prompt)
            ct = (usage or {}).get("completion_tokens") or _estimate_tokens(content or "")
            session.add(LlmCall(role=role, purpose=purpose, model=model,
                                prompt_tokens=pt, completion_tokens=ct,
                                latency_ms=latency_ms, status=status, roadmap_id=roadmap_id))
            session.commit()
    except Exception as e:  # noqa: BLE001  记账失败不影响主流程
        logger.warning("记账失败: %s", e)


# ---------- JSON mode 能力缓存 + 降级链 ----------

_json_mode_ok: Dict[str, bool] = {}  # base_url|model -> 是否支持 response_format json_object


def _cap_key(cfg: Dict[str, Any]) -> str:
    """缓存键含模型名：不同模型对 json mode 的支持不同，避免互相连坐。"""
    return f"{cfg['base_url'].rstrip('/')}|{cfg['model']}"


def _extract_json(text: str) -> Dict[str, Any]:
    """从模型输出提取 JSON 对象。

    顺序：直接解析 → 逐个 ``` 围栏块尝试 → 平衡大括号兜底。
    不能用"找到第一个围栏就解析"：讲义类 JSON 的字符串值内常嵌 ``` 代码块，
    会被误当成围栏内容导致解析失败。
    """
    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    for m in re.finditer(r"```(?:json)?\s*\n?(.*?)```", text, re.S):
        try:
            return json.loads(m.group(1).strip())
        except json.JSONDecodeError:
            continue
    start = text.find("{")
    if start != -1:  # 从首个 { 起找平衡的 {...} 片段（容忍 JSON 前后的说明文字）
        depth = 0
        for i in range(start, len(text)):
            if text[i] == "{":
                depth += 1
            elif text[i] == "}":
                depth -= 1
                if depth == 0:
                    try:
                        return json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
    raise ValueError("输出中未找到合法 JSON")


def _status_error(resp: httpx.Response, detail: str) -> Exception:
    """按状态码分类：429/5xx 可重试(HTTPStatusError)，其余 4xx 立即失败(ApiError)。"""
    if resp.status_code in (429, 500, 502, 503, 504):
        return httpx.HTTPStatusError(f"retryable {resp.status_code}: {detail}",
                                     request=resp.request, response=resp)
    return ApiError(f"HTTP {resp.status_code}: {detail}", status=resp.status_code)


async def _stream_collect(cfg: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    """流式接收（推理模型思考期长，逐块读取防读超时）；reasoning_content 忽略。"""
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {cfg['api_key']}"}
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        async with client.stream("POST", url, headers=headers,
                                 json={**body, "stream": True}) as resp:
            if resp.status_code >= 400:
                detail = (await resp.aread()).decode("utf-8", "replace")[:300]
                raise _status_error(resp, detail)
            parts: List[str] = []
            usage: Optional[Dict[str, int]] = None
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if chunk.get("usage"):
                    usage = chunk["usage"]
                try:
                    delta = chunk["choices"][0].get("delta") or {}
                except (KeyError, IndexError):
                    continue
                if delta.get("content"):
                    parts.append(delta["content"])
            return {"content": "".join(parts), "usage": usage}


async def _http_post(cfg: Dict[str, Any], body: Dict[str, Any]) -> Dict[str, Any]:
    """POST /chat/completions，返回 {"content", "usage"}。

    默认非流式（完整响应自带 usage，记账精确）；读超时（推理模型思考过长，
    300s 内无完整响应）自动降级为流式按块接收——此时无 usage，退化为估算记账。
    429/5xx 与连接类错误指数退避重试；其余 4xx 立即失败；连接后读超时不重试。
    """
    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {cfg['api_key']}"}
    last_err: Optional[Exception] = None
    for attempt in range(RETRY_ON_STATUS):
        try:
            async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
                resp = await client.post(url, headers=headers, json=body)
                if resp.status_code >= 400:
                    raise _status_error(resp, resp.text[:300])
                data = resp.json()
                msg = data["choices"][0]["message"]
                return {"content": msg.get("content") or "", "usage": data.get("usage")}
        except httpx.HTTPStatusError as e:
            last_err = e
        except httpx.TransportError as e:
            if isinstance(e, (httpx.ReadTimeout, httpx.ReadError)):
                try:
                    return await _stream_collect(cfg, body)
                except ApiError:
                    raise
                except (httpx.HTTPStatusError, httpx.TransportError) as se:
                    if isinstance(se, (httpx.ReadTimeout, httpx.ReadError)):
                        raise ApiError("模型长时间无输出（流式接收仍超时）", is_timeout=True)
                    last_err = se
            else:
                last_err = e  # 连接类错误，可重试
        wait = 2 ** attempt
        logger.warning("API 调用失败(%s，第%d次)，%ds 后重试", last_err, attempt + 1, wait)
        await asyncio.sleep(wait)
    raise ApiError(f"API 重试 {RETRY_ON_STATUS} 次后仍失败: {last_err}")


async def _real_call(role: str, cfg: Dict[str, Any], prompt: str, purpose: str,
                     roadmap_id: Optional[int] = None) -> Dict[str, Any]:
    """真实调用 + 降级链：JSON mode → 裸 prompt(内嵌 schema) + 解析重试。"""
    supports_json = _json_mode_ok.get(_cap_key(cfg), True)  # 未知先乐观尝试
    messages = [{"role": "user", "content": prompt}]

    for attempt in range(JSON_PARSE_RETRY + 1):
        body: Dict[str, Any] = {
            "model": cfg["model"], "messages": messages, "temperature": 0.3,
        }
        if supports_json:
            body["response_format"] = {"type": "json_object"}

        t0 = time.monotonic()
        try:
            data = await _http_post(cfg, body)
        except ApiError as e:
            # 仅 4xx（非 429）才可能是 response_format 不被支持 → 降级重试；
            # 超时/5xx/网络错误重试同样的请求没有意义，直接抛出
            if supports_json and e.status is not None and 400 <= e.status < 500 and e.status != 429:
                _json_mode_ok[_cap_key(cfg)] = False
                supports_json = False
                logger.warning("疑似 JSON mode 不支持(HTTP %s)，降级为裸提示词", e.status)
                continue
            _record_call(role, purpose, cfg["model"], prompt, "",
                         int((time.monotonic() - t0) * 1000), "error", roadmap_id)
            raise
        latency = int((time.monotonic() - t0) * 1000)
        content = data["content"]
        if not content.strip():
            # 推理模型偶发把全部输出留在思考(reasoning)里、content 为空：
            # 视同一次失败，优先怀疑 JSON mode 与该模型的组合，降级重试
            if supports_json:
                _json_mode_ok[_cap_key(cfg)] = False
                supports_json = False
                logger.warning("模型返回空 content（疑似 json mode 与推理模型冲突），降级为裸提示词")
                continue
            _record_call(role, purpose, cfg["model"], prompt, "",
                         latency, "error", roadmap_id)
            raise ApiError("模型返回了空内容（思考过长未产出正文），请降低任务复杂度或更换模型")
        try:
            parsed = _extract_json(content)
        except (json.JSONDecodeError, ValueError) as e:
            logger.warning("JSON 解析失败(第%d次): %s", attempt + 1, e)
            _record_call(role, purpose, cfg["model"], prompt, content, latency,
                         "parse_error", roadmap_id, data.get("usage"))
            messages = [{"role": "user", "content": prompt},
                        {"role": "assistant", "content": content[:2000]},
                        {"role": "user", "content":
                         f"上次输出不是合法 JSON（错误：{e}）。请只输出符合要求的 JSON，不要任何其他文字。"}]
            continue
        _record_call(role, purpose, cfg["model"], prompt, content, latency,
                     "ok", roadmap_id, data.get("usage"))
        return parsed
    raise RuntimeError("模型未能输出合法 JSON（已重试）")


async def call_json(role: str, prompt: str, mock_payload: Optional[Dict[str, Any]] = None,
                    mock_delay: float = 2.0, purpose: str = "", roadmap_id: Optional[int] = None
                    ) -> Dict[str, Any]:
    """按环节调用 LLM 返回 JSON；未配置该环节时返回 mock_payload（演示模式）。"""
    cfg = get_role_cfg(role)
    if not is_configured(cfg):
        await asyncio.sleep(mock_delay)
        _record_call(role, purpose or "mock", "demo-mock", "", "", int(mock_delay * 1000),
                     "mock", roadmap_id)
        if mock_payload is None:
            raise RuntimeError(f"演示模式缺少 {role} 的 mock 数据")
        return mock_payload
    return await _real_call(role, cfg, prompt, purpose or role, roadmap_id)


async def test_role(role: str) -> Dict[str, Any]:
    """连通性测试：按 planner 实际请求形态发一次最小调用（含 JSON mode 探测）。"""
    cfg = get_role_cfg(role)
    if not is_configured(cfg):
        return {"ok": False, "error": "该环节未配置完整（base_url / api_key / model 均必填）"}
    messages = [{"role": "user", "content": '请只输出 JSON：{"ok": true}'}]
    for with_json in (True, False):  # 先测 JSON mode，4xx 则降级为普通调用再测
        body: Dict[str, Any] = {"model": cfg["model"], "messages": messages, "temperature": 0}
        if with_json:
            body["response_format"] = {"type": "json_object"}
        try:
            t0 = time.monotonic()
            data = await _http_post(cfg, body)
        except ApiError as e:
            if with_json and e.status is not None and 400 <= e.status < 500 and e.status != 429:
                continue
            return {"ok": False, "error": str(e)}
        latency = int((time.monotonic() - t0) * 1000)
        content = data["content"]
        ok = "true" in content.lower()
        _json_mode_ok[_cap_key(cfg)] = with_json  # 探测结果直接缓存，planner 免走弯路
        _record_call(role, "connectivity-test", cfg["model"], content, content, latency,
                     "ok" if ok else "bad_output")
        return {"ok": ok, "latency_ms": latency, "json_mode": with_json}
    return {"ok": False, "error": "unreachable"}


# ---------- assistant 流式对话 ----------

ASSISTANT_SYSTEM = (
    "你是 StudyForge 的学习伴侣。用户的学习路线目标：{goal}。\n"
    "当前正在学习「{node_title}」（知识点：{kp_list}）。\n"
    "当前节点内容摘要：{summary}\n\n"
    "要求：1) 优先结合当前学习内容解答，举例尽量贴近本节点知识点且必须使用该路线的技术栈；"
    "2) 回答简洁（一般不超过 300 字），必要时给一个小例子或代码；"
    "3) 用户问的与当前学习无关时，可以回答但提醒回到学习；"
    "4) 使用中文，markdown 格式。"
)

_MOCK_ANSWERS = [
    "这个问题和当前节点「{node_title}」直接相关。可以这样理解：先抓住它解决的核心问题，"
    "再看它的基本用法，最后自己动手跑一个小例子验证——概念 → 用法 → 验证 三步走。\n\n"
    "```python\n# 动手验证一下\nprint('试试把例子改成你自己的场景')\n```",
    "关于「{question}」，可以从两个角度入手：① 它是什么（定义/语法层面）；② 什么时候用（场景层面）。"
    "讲义的「要点讲解」小节有对应说明，建议对照着看，再把示例代码改一改跑一遍。",
    "这是个好问题。结合本节知识点，建议先回顾讲义中的示例，"
    "然后试着用自己的话复述一遍——能复述清楚就说明理解到位了。",
]


async def chat_stream(messages: List[Dict[str, str]], roadmap_id: Optional[int] = None):
    """assistant 流式对话：逐段 yield 文本 delta。"""
    cfg = get_role_cfg("assistant")
    last_user = next((m["content"] for m in reversed(messages) if m["role"] == "user"), "")
    if not is_configured(cfg):
        # 演示模式：按问题长度选模板，分段流式输出
        answer = _MOCK_ANSWERS[len(last_user) % len(_MOCK_ANSWERS)]
        for key, val in (
            ("node_title", "当前节点"), ("kp_list", "本节知识点"), ("question", last_user),
        ):
            answer = answer.replace("{" + key + "}", val)
        _record_call("assistant", "chat", "demo-mock", last_user, answer,
                     800, "mock", roadmap_id)
        for i in range(0, len(answer), 6):
            yield answer[i:i + 6]
            await asyncio.sleep(0.04)
        return

    url = cfg["base_url"].rstrip("/") + "/chat/completions"
    headers = {"Authorization": f"Bearer {cfg['api_key']}"}
    body = {"model": cfg["model"], "messages": messages, "temperature": 0.5, "stream": True}
    t0 = time.monotonic()
    chunks: List[str] = []
    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        async with client.stream("POST", url, headers=headers, json=body) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line.startswith("data:"):
                    continue
                payload = line[5:].strip()
                if payload == "[DONE]":
                    break
                try:
                    delta = json.loads(payload)["choices"][0]["delta"].get("content", "")
                except (json.JSONDecodeError, KeyError, IndexError):
                    continue
                if delta:
                    chunks.append(delta)
                    yield delta
    _record_call("assistant", "chat", cfg["model"], last_user, "".join(chunks),
                 int((time.monotonic() - t0) * 1000), "ok", roadmap_id)
