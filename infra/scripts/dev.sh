#!/bin/bash

# Start infra if not running (optional, as docker might require sudo or manual start)
# docker compose -f infra/docker/docker-compose.yml up -d

# Start all apps in dev mode using pnpm recursive
pnpm -r --parallel dev
