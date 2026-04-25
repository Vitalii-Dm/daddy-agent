#!/usr/bin/env bash
# Regenerate SRI integrity hashes for the CDN scripts in
# src/daddy_agent/viz/static/index.html and replace the placeholders.
#
# Why: SRI protects the dashboard against CDN tampering. Version pins alone
# do NOT — a republished tag (intentional or malicious) loads whatever the
# CDN currently serves. Running this before every deploy closes that gap.
#
# Implemented in Python (not pure bash) because macOS still ships bash 3.2,
# which lacks `declare -A`.  Python 3 is already a project dep.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
exec python3 scripts/_compute_sri_hashes.py "$@"
