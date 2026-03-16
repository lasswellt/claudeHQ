.PHONY: build up down logs backup status dev test lint clean

build:
	docker compose build

up:
	docker compose up -d

down:
	docker compose down

logs:
	docker compose logs -f hub

status:
	docker compose ps
	@echo "---"
	@curl -s http://localhost:7700/health 2>/dev/null | python3 -m json.tool || echo "Hub not reachable"

dev:
	pnpm turbo dev

test:
	npx vitest run

lint:
	pnpm lint

clean:
	pnpm turbo clean
	docker compose down -v --rmi local

backup:
	docker compose exec hub sqlite3 /app/data/db/chq.db ".backup /app/data/db/backup-$$(date +%Y%m%d).db"
