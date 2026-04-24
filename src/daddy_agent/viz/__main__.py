"""``python -m daddy_agent.viz`` entry point.

Starts a uvicorn server on ``localhost:9749``.
"""

from __future__ import annotations

import argparse
import logging


def main() -> None:
    parser = argparse.ArgumentParser(description="Daddy-agent graph dashboard")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=9749)
    parser.add_argument("--log-level", default="info")
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args()

    logging.basicConfig(level=args.log_level.upper())

    import uvicorn  # imported late so ``--help`` works without uvicorn installed

    uvicorn.run(
        "daddy_agent.viz.server:app",
        host=args.host,
        port=args.port,
        log_level=args.log_level,
        reload=args.reload,
    )


if __name__ == "__main__":  # pragma: no cover
    main()
