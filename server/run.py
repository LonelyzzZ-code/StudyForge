"""PyInstaller 打包入口：桌面壳以 env STUDYFORGE_PORT（或 --port）启动本进程。"""
import os
import sys

import uvicorn

from app.main import app


def main() -> None:
    port = int(os.environ.get("STUDYFORGE_PORT") or 8765)
    if "--port" in sys.argv:
        try:
            port = int(sys.argv[sys.argv.index("--port") + 1])
        except (ValueError, IndexError):
            pass
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
