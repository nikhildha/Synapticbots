#!/bin/bash
# ── ENGINE Startup Script ──────────────────────────────────────────────
# By default, Railway's Nixpacks Python buildpack aggressively auto-detects
# Flask/FastAPI projects and overrides any Dockerfile CMD or toml startCommand
# with its own `flask run` or `gunicorn` command.
# 
# This breaks the Engine because Gunicorn's process-forking model immediately
# kills the background bot thread `start_engine()`.
# 
# We explicitly use this script as the Dockerfile ENTRYPOINT to guarantee
# the module runs natively as `python engine_api.py`.
# ───────────────────────────────────────────────────────────────────────

set -e

echo "🚀 Booting Synaptic Python Engine via Native Process..."
exec python engine_api.py
