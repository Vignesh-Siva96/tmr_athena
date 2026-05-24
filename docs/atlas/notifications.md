---
title: Notifications
stack: [NestJS, Prisma, 30s polling]
status: working
last-reviewed: 2026-05-21
---

# Notifications

## What it does

In-app notifications for agents. Currently scoped to GitHub `fix-deployed` events — when a linked issue gets the `fix-deployed` label, every agent sees it in the sidebar bell + the GitHub "Action Needed" page.

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

- Only one notification kind (`GITHUB_FIX_DEPLOYED`) — no notifications yet for new tickets, assignments, mentions, SLA breaches.
- Polling, not push. Should move to SSE when we want sub-second latency.
- No per-agent scoping (assignment isn't access control).
