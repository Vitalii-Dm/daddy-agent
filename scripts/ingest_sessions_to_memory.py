#!/usr/bin/env python3
"""Batch-ingest Claude Code session JSONL files into the Neo4j memory graph.

Creates Session and Message nodes so the memory tab in the Aurora dashboard
shows past conversation history. Reads from ~/.claude/projects/.

Usage:
    python scripts/ingest_sessions_to_memory.py [--project-dir PATH] [--limit N]
"""

import json
import logging
import os
import sys
from pathlib import Path

from neo4j import GraphDatabase

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger(__name__)

NEO4J_URI = os.environ.get("NEO4J_URI", "bolt://localhost:7687")
NEO4J_USER = os.environ.get("NEO4J_USER", "neo4j")
NEO4J_PASSWORD = os.environ.get("NEO4J_PASSWORD", "")
NEO4J_DB = os.environ.get("NEO4J_MEMORY_DB", "neo4j")

CLAUDE_PROJECTS_DIR = Path.home() / ".claude" / "projects"

CREATE_SESSION = """
MERGE (s:Session {session_id: $session_id})
SET s.project = $project,
    s.started_at = $started_at,
    s.message_count = $message_count,
    s.updated_at = timestamp()
"""

CREATE_MESSAGE = """
MATCH (s:Session {session_id: $session_id})
MERGE (m:Message {id: $msg_id})
SET m.role = $role,
    m.text = $text,
    m.timestamp = $timestamp,
    m.session_id = $session_id
MERGE (s)-[:HAS_MESSAGE]->(m)
"""

CREATE_ENTITY = """
MERGE (e:Entity {name: $name})
SET e.type = $type,
    e.last_seen = timestamp()
"""

LINK_ENTITY_TO_SESSION = """
MATCH (s:Session {session_id: $session_id})
MATCH (e:Entity {name: $name})
MERGE (s)-[:MENTIONS]->(e)
"""

LINK_ENTITIES = """
MATCH (e1:Entity {name: $from_name})
MATCH (e2:Entity {name: $to_name})
MERGE (e1)-[:RELATED_TO]->(e2)
"""


def extract_text(content) -> str:
    """Extract text from message content (string or content blocks)."""
    if isinstance(content, str):
        return content[:2000]
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
        return "\n".join(parts)[:2000]
    return ""


def extract_entities_from_text(text: str) -> list[dict]:
    """Simple entity extraction — file paths, function names, imports."""
    entities = []
    seen = set()

    # File paths
    for word in text.split():
        if "/" in word and ("src/" in word or "." in word.split("/")[-1]):
            clean = word.strip("()[]{}\"'`,;:")
            if clean and clean not in seen and len(clean) < 200:
                entities.append({"name": clean, "type": "File"})
                seen.add(clean)

    # Tool names
    for tool in ["Read", "Write", "Edit", "Bash", "Grep", "Glob"]:
        if f"tool_use" in text and tool in text:
            if tool not in seen:
                entities.append({"name": tool, "type": "Tool"})
                seen.add(tool)

    return entities[:20]  # cap at 20 per message


def ingest_session(driver, session_file: Path, project_name: str):
    """Ingest a single JSONL session file into Neo4j."""
    session_id = session_file.stem
    messages = []

    try:
        with open(session_file) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    msg = json.loads(line)
                    msg_type = msg.get("type", "")
                    if msg_type in ("assistant", "user", "system"):
                        role = msg_type
                        content = msg.get("message", {}).get("content", "") if isinstance(msg.get("message"), dict) else msg.get("content", "")
                        text = extract_text(content)
                        if text:
                            messages.append({
                                "role": role,
                                "text": text,
                                "timestamp": msg.get("timestamp", ""),
                                "uuid": msg.get("uuid", f"{session_id}-{len(messages)}"),
                            })
                except json.JSONDecodeError:
                    continue
    except Exception as e:
        log.warning(f"Failed to read {session_file}: {e}")
        return 0

    if not messages:
        return 0

    with driver.session(database=NEO4J_DB) as session:
        # Create session node
        session.run(
            CREATE_SESSION,
            session_id=session_id,
            project=project_name,
            started_at=messages[0].get("timestamp", ""),
            message_count=len(messages),
        )

        # Create message nodes
        all_entities = set()
        for msg in messages[:100]:  # cap at 100 messages per session
            session.run(
                CREATE_MESSAGE,
                session_id=session_id,
                msg_id=msg["uuid"],
                role=msg["role"],
                text=msg["text"],
                timestamp=msg.get("timestamp", ""),
            )

            # Extract and create entities
            entities = extract_entities_from_text(msg["text"])
            for entity in entities:
                session.run(CREATE_ENTITY, name=entity["name"], type=entity["type"])
                session.run(
                    LINK_ENTITY_TO_SESSION,
                    session_id=session_id,
                    name=entity["name"],
                )
                all_entities.add(entity["name"])

        # Link entities that co-occur in the same session
        entity_list = list(all_entities)
        for i in range(min(len(entity_list), 10)):
            for j in range(i + 1, min(len(entity_list), 10)):
                session.run(
                    LINK_ENTITIES,
                    from_name=entity_list[i],
                    to_name=entity_list[j],
                )

    return len(messages)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Ingest sessions to memory graph")
    parser.add_argument("--project-dir", type=str, default=None, help="Specific project dir")
    parser.add_argument("--limit", type=int, default=50, help="Max sessions to ingest")
    args = parser.parse_args()

    if not NEO4J_PASSWORD:
        log.error("NEO4J_PASSWORD env var required")
        sys.exit(1)

    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USER, NEO4J_PASSWORD))

    # Create indexes
    with driver.session(database=NEO4J_DB) as session:
        session.run("CREATE INDEX session_id IF NOT EXISTS FOR (s:Session) ON (s.session_id)")
        session.run("CREATE INDEX message_id IF NOT EXISTS FOR (m:Message) ON (m.id)")
        session.run("CREATE INDEX entity_name IF NOT EXISTS FOR (e:Entity) ON (e.name)")

    total_messages = 0
    total_sessions = 0

    if args.project_dir:
        project_dirs = [Path(args.project_dir)]
    else:
        project_dirs = sorted(CLAUDE_PROJECTS_DIR.iterdir()) if CLAUDE_PROJECTS_DIR.exists() else []

    for project_dir in project_dirs:
        if not project_dir.is_dir():
            continue
        project_name = project_dir.name
        jsonl_files = sorted(project_dir.glob("*.jsonl"))

        if not jsonl_files:
            continue

        log.info(f"Project: {project_name} ({len(jsonl_files)} sessions)")

        for session_file in jsonl_files[: args.limit]:
            count = ingest_session(driver, session_file, project_name)
            if count > 0:
                total_sessions += 1
                total_messages += count

    driver.close()
    log.info(f"Done: {total_sessions} sessions, {total_messages} messages ingested")


if __name__ == "__main__":
    main()
