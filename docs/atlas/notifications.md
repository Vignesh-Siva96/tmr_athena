---
title: Notifications
stack: [NestJS, Prisma, 30s polling]
status: working
last-reviewed: 2026-06-10
---

# Notifications

## What it does

In-app notifications for agents. Two kinds exist today:

- **`GITHUB_FIX_DEPLOYED`** — when a linked issue gets the `fix-deployed` label, every agent sees it in the sidebar bell + the GitHub "Action Needed" page.
- **`CHURN_RISK_DETECTED`** — created by `AnalyzeMessageWorker` ([ai.md](ai.md)) when Gemini detects a churn signal in a customer message (alongside the `CustomerSignal` row and a NORMAL → HIGH priority bump).

## Model

- Global `Notification` rows (every agent sees every notification).
- Per-agent `NotificationRead` rows track who has dismissed what.
- Bridge polls `GET /notifications/unread-count` every 30 s.

## Key files

| File | Role |
|---|---|
| [`apps/api/src/modules/notifications/notifications.controller.ts`](../../apps/api/src/modules/notifications/notifications.controller.ts) | HTTP surface |
| [`apps/api/src/modules/notifications/notifications.service.ts`](../../apps/api/src/modules/notifications/notifications.service.ts) | List, unread count, mark read, mark all read |
| [`apps/bridge/src/components/dashboard/Sidebar.tsx`](../../apps/bridge/src/components/dashboard/Sidebar.tsx) | Polling + unread badge |
| [`apps/bridge/src/components/dashboard/NotificationsPanel.tsx`](../../apps/bridge/src/components/dashboard/NotificationsPanel.tsx) | Slide-over panel |
| [`apps/bridge/src/app/github/page.tsx`](../../apps/bridge/src/app/github/page.tsx) | Full Action Needed view |

## Endpoints

See `NotificationsController` in [_generated/api-routes.md](_generated/api-routes.md#notificationscontroller).

## Known gaps

- Only two notification kinds (`GITHUB_FIX_DEPLOYED`, `CHURN_RISK_DETECTED`) — no notifications yet for new tickets, assignments, mentions, SLA breaches.
- Polling, not push. Should move to SSE when we want sub-second latency.
- No per-agent scoping (assignment isn't access control).
