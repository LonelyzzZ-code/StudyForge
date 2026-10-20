"""Database setup: SQLite + SQLModel (sync engine, demo).

demo 说明：正式版按 03 架构用 aiosqlite + 数据目录规范；demo 用同步引擎 +
项目内 data/ 目录，保持代码简单。
"""
import os

from sqlmodel import SQLModel, Session, create_engine

DATA_DIR = os.environ.get("STUDYFORGE_DATA_DIR") or os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
os.makedirs(DATA_DIR, exist_ok=True)

DB_PATH = os.path.join(DATA_DIR, "studyforge.db")

engine = create_engine(
    f"sqlite:///{DB_PATH}",
    connect_args={"check_same_thread": False},
)


def init_db() -> None:
    import app.models  # noqa: F401  ensure tables registered

    SQLModel.metadata.create_all(engine)


def get_session() -> Session:
    with Session(engine) as session:
        yield session
