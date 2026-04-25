.DEFAULT_GOAL := help

SHELL := /bin/bash

.PHONY: help up down logs init-db test fmt lint clean

help:
	@echo "Targets:"
	@echo "  up        Start Neo4j via docker compose (detached)"
	@echo "  down      Stop and remove Neo4j containers"
	@echo "  logs      Tail Neo4j logs"
	@echo "  init-db   Create codebase and agent_memory databases"
	@echo "  test      Run pytest"
	@echo "  fmt       ruff format src tests"
	@echo "  lint      ruff check + mypy src"
	@echo "  clean     Remove Python caches and build artifacts"

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f neo4j

init-db:
	bash scripts/init-databases.sh

test:
	pytest

fmt:
	ruff format src tests

lint:
	ruff check src tests
	mypy src

clean:
	rm -rf build dist *.egg-info .pytest_cache .mypy_cache .ruff_cache
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
