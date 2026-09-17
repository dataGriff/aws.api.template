#!/usr/bin/env bash
# Open an interactive SQL console (Harlequin) against the selected environment.
# Defaults to the local stack; export DATABASE_URL to target another env.
set -euo pipefail

DATABASE_URL="${DATABASE_URL:-postgresql://app:app@localhost:5432/app}"
exec harlequin -a postgres "$DATABASE_URL"
