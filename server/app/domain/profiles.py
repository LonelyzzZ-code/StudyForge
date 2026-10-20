"""Domain profile packs (E4, demo: code only)."""

CODE_PROFILE = {
    "name": "code",
    "label": "编程技术",
    "description": "结构化编程学习：概念 → 语法 → 实践",
    "lecture_sections": ["概念引入", "要点讲解", "示例与练习"],
    "question_quota": {"concept": 3, "basic": 4},   # demo 题量(正式版 8~12)
    "question_types": {"concept": ["choice", "blank"], "basic": ["choice", "blank", "short"]},
    "mastery_threshold": 0.85,
    "ready_window": 3,                              # 就绪窗口节点数
}

PROFILES = {"code": CODE_PROFILE}

# 关键词粗筛：命中才允许创建（demo 仅 code；正式版接入模板包体系）
# 注意：需覆盖 tech/radar_data.py 全部 preset_goal，且与 web/src/pages/CreateRoadmap.tsx 的 HINTS 保持同步
CODE_HINTS = [
    "python", "java", "javascript", "typescript", "c语言", "c++", "go", "golang", "rust",
    "zig", "编程", "编程语言", "爬虫", "前端", "后端", "算法", "数据结构", "sql", "数据库",
    "web", "webassembly", "linux", "git", "docker", "机器学习", "深度学习", "ai",
    "llm", "大模型", "api", "rag", "agent", "ollama", "react", "next", "vue",
    "kubernetes", "k8s", "云原生", "可观测性", "opentelemetry", "ci/cd", "供应链",
]


def detect_domain(goal: str) -> str:
    text = goal.lower()
    if any(h in text for h in CODE_HINTS):
        return "code"
    return ""


def get_profile(domain: str) -> dict:
    return PROFILES.get(domain, {})
