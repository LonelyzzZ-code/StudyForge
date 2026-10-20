"""Local embedding via fastembed (BAAI/bge-small-zh-v1.5, ONNX int8).

仅两处使用：质检重复度、变式题相似度校验。懒加载单例；首次使用下载模型到
用户缓存目录（打包版随 resources 分发，见 scripts/build-server.sh）。
"""
import logging
import os
from functools import lru_cache
from typing import List, Sequence

logger = logging.getLogger("studyforge.embedding")

MODEL_NAME = "BAAI/bge-small-zh-v1.5"

# 相似度区间（模板包可覆盖）：过低=考点漂移，过高=变式不足
VARIANT_SIM_BOUNDS = (0.55, 0.92)
# 质检：与直接前驱摘要重复度阈值
DUP_SIM_THRESHOLD = 0.90


@lru_cache(maxsize=1)
def _model():
    from fastembed import TextEmbedding  # 延迟导入：启动不阻塞，mock 模式不加载

    cache_dir = os.environ.get("STUDYFORGE_MODEL_DIR") or None
    logger.info("加载 embedding 模型 %s …", MODEL_NAME)
    return TextEmbedding(model_name=MODEL_NAME, cache_dir=cache_dir)


@lru_cache(maxsize=512)
def embed(text: str) -> tuple:
    vec = next(iter(_model().embed([text[:2000]])))
    return tuple(vec)


def cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def similarity(a: str, b: str) -> float:
    return cosine(embed(a), embed(b))


def variant_in_bounds(sim: float, bounds=None) -> bool:
    lo, hi = bounds or VARIANT_SIM_BOUNDS
    return lo <= sim <= hi
