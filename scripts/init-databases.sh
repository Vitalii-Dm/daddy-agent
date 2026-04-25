#!/usr/bin/env bash
# Idempotently create the `codebase` and `agent_memory` databases in Neo4j.
#
# Requires the Neo4j container (from docker-compose.yml) to be running.
# Reads NEO4J_PASSWORD from the environment (or from a sibling .env file).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Load .env if present and NEO4J_PASSWORD not already set
if [[ -z "${NEO4J_PASSWORD:-}" ]] && [[ -f "${REPO_ROOT}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  source "${REPO_ROOT}/.env"
  set +a
fi

NEO4J_USER="${NEO4J_USER:-neo4j}"
NEO4J_PASSWORD="${NEO4J_PASSWORD:?NEO4J_PASSWORD must be set (export it or put it in .env)}"
NEO4J_CODEBASE_DB="${NEO4J_CODEBASE_DB:-codebase}"
NEO4J_MEMORY_DB="${NEO4J_MEMORY_DB:-agent_memory}"
CONTAINER_NAME="${NEO4J_CONTAINER:-daddy-agent-neo4j}"

MAX_WAIT_SECONDS="${MAX_WAIT_SECONDS:-120}"

echo "Waiting for Neo4j in container '${CONTAINER_NAME}' to accept connections..."
elapsed=0
until docker exec "${CONTAINER_NAME}" \
    cypher-shell -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" \
    "RETURN 1;" >/dev/null 2>&1; do
  if (( elapsed >= MAX_WAIT_SECONDS )); then
    echo "ERROR: Neo4j did not become ready within ${MAX_WAIT_SECONDS}s" >&2
    exit 1
  fi
  sleep 2
  elapsed=$(( elapsed + 2 ))
done
echo "Neo4j is ready."

run_system_cypher() {
  local stmt="$1"
  docker exec "${CONTAINER_NAME}" \
    cypher-shell -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" \
    -d system "${stmt}"
}

# Detect Community vs Enterprise: only Enterprise supports multi-database.
EDITION="$(docker exec "${CONTAINER_NAME}" \
  cypher-shell -u "${NEO4J_USER}" -p "${NEO4J_PASSWORD}" --format plain \
  "CALL dbms.components() YIELD edition RETURN edition;" 2>/dev/null \
  | tail -n1 | tr -d '"')"

if [[ "${EDITION}" != "enterprise" ]]; then
  cat <<EOF
Detected Neo4j edition: ${EDITION:-unknown}
  Multi-database support requires Neo4j Enterprise. Community Edition
  ships with a single user database named 'neo4j'. Both the codebase
  graph and the agent-memory graph will share that single DB; the
  schemas have disjoint labels (File/Function/Class vs Session/
  Message/Entity/...) so they coexist without collision.

  Override .env to:
    NEO4J_CODEBASE_DB=neo4j
    NEO4J_MEMORY_DB=neo4j

  No DDL needed — 'neo4j' is created automatically. Skipping CREATE.
EOF
  echo
  echo "Existing databases:"
  run_system_cypher "SHOW DATABASES YIELD name, currentStatus RETURN name, currentStatus;"
  exit 0
fi

echo "Creating database: ${NEO4J_CODEBASE_DB} (if not exists)"
run_system_cypher "CREATE DATABASE ${NEO4J_CODEBASE_DB} IF NOT EXISTS WAIT;"

echo "Creating database: ${NEO4J_MEMORY_DB} (if not exists)"
run_system_cypher "CREATE DATABASE ${NEO4J_MEMORY_DB} IF NOT EXISTS WAIT;"

echo "Databases ready:"
run_system_cypher "SHOW DATABASES YIELD name, currentStatus WHERE name IN ['${NEO4J_CODEBASE_DB}', '${NEO4J_MEMORY_DB}'] RETURN name, currentStatus;"
