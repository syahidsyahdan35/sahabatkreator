# Modul `agents`

Manajemen AI agent per tenant + antrean draf balasan mode 'suggest' (Fase 3A).

Status: **live sejak Fase 3A** — route di `routes.ts`:
- `POST/GET /tenants/:tenantId/agents`, `PATCH .../agents/:id`
- `GET /tenants/:tenantId/suggestions?status=`,
  `POST .../suggestions/:id/approve`, `POST .../suggestions/:id/reject`

Service domainnya di `@sahabat-kreator/core` (`agents.ts`, `suggestions.ts`);
runtime agent (loop, retrieval, tools, metering) berjalan di worker lewat
job `agent.respond` — lihat `packages/core/src/agent-runtime.ts` dan
`@sahabat-kreator/ai` untuk provider LLM (mock default, OpenRouter via env).
