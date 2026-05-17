# Conventions — TMR Support Platform

Strict rules for code style, naming, file structure.
Claude Code must follow these in every session.

---

## TypeScript Rules

```typescript
// ✅ Strict typing — no any
const ticket: Ticket = await ticketsService.findById(id, orgId)

// ❌ Never use any
const ticket: any = ...

// ✅ Zod for all validation
const createTicketSchema = z.object({
  title: z.string().min(1).max(120),
  category: z.nativeEnum(TicketCategory),
})

// ✅ Use types from packages/types — never redefine
import type { Ticket, TicketStatus } from '@tmr/types'

// ✅ Explicit return types on all functions
async function findById(id: string, orgId: string): Promise<Ticket> {}

// ✅ Use enums from Prisma client for database enums
import { TicketStatus, TicketCategory } from '@tmr/db'
```

---

## File Naming

```
React components:     PascalCase.tsx         TicketCard.tsx
React hooks:          camelCase.ts           useTickets.ts
Utility functions:    camelCase.ts           formatDate.ts
NestJS modules:       kebab-case/            tickets/
NestJS files:         tickets.module.ts
                      tickets.service.ts
                      tickets.controller.ts
                      tickets.dto.ts
                      tickets.guard.ts
Test files:           same-name.spec.ts      tickets.service.spec.ts
Type files:           kebab-case.ts          ticket.types.ts
```

---

## NestJS Conventions

### Module Structure

Every feature follows this exact pattern:

```
modules/tickets/
├── tickets.module.ts        ← imports, providers, exports
├── tickets.controller.ts    ← HTTP handlers, guards, decorators
├── tickets.service.ts       ← business logic
├── tickets.dto.ts           ← Zod schemas + DTO types
└── tickets.spec.ts          ← unit tests
```

### Controller Pattern

```typescript
@Controller('tickets')
@UseGuards(AuthGuard, OrgGuard)
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  async list(@CurrentOrg() org: Org, @Query() query: ListTicketsDto) {
    return this.ticketsService.list(org.id, query)
  }

  @Post()
  async create(@CurrentOrg() org: Org, @Body() dto: CreateTicketDto) {
    return this.ticketsService.create(org.id, dto)
  }
}
```

### Service Pattern

```typescript
@Injectable()
export class TicketsService {
  constructor(private readonly db: PrismaService) {}

  // orgId is ALWAYS the first parameter
  async list(orgId: string, query: ListTicketsQuery): Promise<PaginatedTickets> {
    return this.db.ticket.findMany({
      where: { orgId, deletedAt: null, ...buildFilters(query) },
      include: { user: true, assignee: true, tags: true },
      orderBy: { updatedAt: 'desc' },
      take: query.limit ?? 25,
      skip: query.offset ?? 0,
    })
  }

  async create(orgId: string, dto: CreateTicketDto): Promise<Ticket> {
    return this.db.$transaction(async (tx) => {
      const number = await getNextTicketNumber(tx, orgId)
      return tx.ticket.create({
        data: { orgId, number, ...dto },
      })
    })
  }
}
```

### DTO Pattern

```typescript
// tickets.dto.ts
export const createTicketSchema = z.object({
  title: z.string().min(1).max(120),
  category: z.nativeEnum(TicketCategory),
  product: z.string().optional(),
  connector: z.string().optional(),
  description: z.string().optional(),
})
export type CreateTicketDto = z.infer<typeof createTicketSchema>

export const listTicketsSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
  search: z.string().optional(),
})
export type ListTicketsQuery = z.infer<typeof listTicketsSchema>
```

---

## Next.js Conventions

### Page Pattern

```typescript
// app/tickets/page.tsx
import { getTickets } from '@/lib/api/tickets'

// Always use server components for data fetching where possible
export default async function TicketsPage() {
  const tickets = await getTickets()
  return <TicketList tickets={tickets} />
}
```

### Client Component Pattern

```typescript
'use client'
// Only add 'use client' when you need interactivity

import { useTickets } from '@/hooks/use-tickets'

export function TicketList() {
  const { data: tickets, isLoading } = useTickets()
  if (isLoading) return <TicketListSkeleton />
  return (...)
}
```

### API Client Pattern

```typescript
// lib/api/tickets.ts
import { apiClient } from '@/lib/api-client'
import type { Ticket, CreateTicketDto } from '@tmr/types'

export async function getTickets(): Promise<Ticket[]> {
  return apiClient.get('/tickets')
}

export async function createTicket(dto: CreateTicketDto): Promise<Ticket> {
  return apiClient.post('/tickets', dto)
}
```

---

## Component Conventions

### Shared UI Components (packages/ui)

```typescript
// Always export from packages/ui/src/index.ts
// Never import directly from shadcn paths in app code
import { Button, Input, Badge } from '@tmr/ui'
```

### Component Props Pattern

```typescript
// Use explicit interface, not inline types
interface TicketCardProps {
  ticket: Ticket
  onSelect?: (id: string) => void
  isSelected?: boolean
  className?: string
}

export function TicketCard({ ticket, onSelect, isSelected, className }: TicketCardProps) {
  ...
}
```

### Styling Pattern

```typescript
// Use cn() helper for conditional classes
import { cn } from '@tmr/ui/utils'

<div className={cn(
  'rounded-lg border p-4',
  isSelected && 'border-blue-500 bg-blue-500/10',
  className
)}>
```

---

## API Response Format

All API responses follow this shape:

```typescript
// Success
{ data: T, meta?: { total: number, limit: number, offset: number } }

// Error
{ error: { code: string, message: string, details?: unknown } }
```

HTTP Status codes:
- 200: success GET/PATCH
- 201: success POST (created)
- 400: validation error
- 401: unauthenticated
- 403: unauthorized (wrong org, wrong role)
- 404: not found
- 500: server error

---

## Import Order

```typescript
// 1. Node built-ins
import { readFile } from 'fs/promises'

// 2. External packages
import { Injectable } from '@nestjs/common'
import { z } from 'zod'

// 3. Internal packages (monorepo)
import type { Ticket } from '@tmr/types'
import { PrismaService } from '@tmr/db'

// 4. Internal app imports (absolute)
import { AuthGuard } from '@/common/guards/auth.guard'

// 5. Relative imports
import { buildFilters } from './tickets.utils'
```

---

## Environment & Config

```typescript
// Never use process.env directly in business logic
// Always go through NestJS ConfigService

@Injectable()
export class EmailService {
  constructor(private readonly config: ConfigService) {}

  private get smtpHost() {
    return this.config.get<string>('SMTP_HOST')
  }
}
```

---

## Error Handling

```typescript
// NestJS: throw NestJS exceptions
throw new NotFoundException(`Ticket ${id} not found`)
throw new ForbiddenException('Not authorized to access this ticket')
throw new BadRequestException('Invalid ticket status transition')

// Next.js: use error boundaries + notFound()
import { notFound } from 'next/navigation'
if (!ticket) notFound()
```

---

## Git Commit Format

```
CP-XX: brief description of what was done

Examples:
CP-01: scaffold turborepo with pnpm workspaces
CP-06: add Better Auth with Google OAuth and email/password
CP-15: implement submit ticket page with guest flow
```

---

## What NEVER To Do

- Never use `console.log` in production code — use NestJS Logger
- Never commit `.env` files
- Never use `px` units in Tailwind — use the spacing scale
- Never hardcode org names, IDs, or slugs
- Never write raw SQL — use Prisma
- Never skip the orgId filter on any database query
- Never build Phase 2 features
- Never duplicate components that exist in packages/ui
