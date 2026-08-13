import 'dotenv/config'
import { faker } from '@faker-js/faker'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import {
  accessGrants,
  agentApprovals,
  agentTasks,
  agents,
  alertHistory,
  alerts,
  auditLog,
  budgetRequests,
  budgets,
  orgs,
  pricingTable,
  teams,
  usageEvents,
  users,
} from '../src/schemas'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required to seed the database')

const client = postgres(databaseUrl, { max: 1 })
const db = drizzle(client)

const demoOrgs = [
  { name: 'Acme Corp', timezone: 'America/New_York' },
  { name: 'Globex Inc', timezone: 'Europe/London' },
  { name: 'Initech', timezone: 'Asia/Karachi' },
] as const

const prices = [
  { provider: 'openai', model: 'gpt-4o', input: 0.005, output: 0.015 },
  { provider: 'anthropic', model: 'claude-sonnet', input: 0.003, output: 0.015 },
  { provider: 'groq', model: 'llama-3.1-70b', input: 0.00059, output: 0.00079 },
] as const

// Super Admin is system-level; users.org_id is non-null, so it is not a tenant user row.
const systemSuperAdminId = '00000000-0000-0000-0000-000000000001'

type SeedUser = { id: string; email: string }
type SeedAgent = {
  id: string
  teamId: string
  status: 'pending_approval' | 'active' | 'paused' | 'pending_deletion'
}

function money(value: number) {
  return value.toFixed(4)
}

async function removeExistingDemoData() {
  const existing = await db
    .select({ id: orgs.id })
    .from(orgs)
    .where(inArray(orgs.name, demoOrgs.map((org) => org.name)))
  const orgIds = existing.map((org) => org.id)

  if (orgIds.length) {
    await db.delete(alertHistory).where(inArray(alertHistory.orgId, orgIds))
    await db.delete(agentApprovals).where(inArray(agentApprovals.orgId, orgIds))
    await db.delete(usageEvents).where(inArray(usageEvents.orgId, orgIds))
    await db.delete(agentTasks).where(inArray(agentTasks.orgId, orgIds))
    await db.delete(budgetRequests).where(inArray(budgetRequests.orgId, orgIds))
    await db.delete(budgets).where(inArray(budgets.orgId, orgIds))
    await db.delete(alerts).where(inArray(alerts.orgId, orgIds))
    await db.delete(auditLog).where(inArray(auditLog.orgId, orgIds))
    await db.delete(accessGrants).where(inArray(accessGrants.orgId, orgIds))
    await db.delete(agents).where(inArray(agents.orgId, orgIds))
    await db.delete(teams).where(inArray(teams.orgId, orgIds))
    await db.delete(users).where(inArray(users.orgId, orgIds))
    await db.delete(pricingTable).where(inArray(pricingTable.orgId, orgIds))
    await db.delete(orgs).where(inArray(orgs.id, orgIds))
  }

  for (const price of prices) {
    await db.delete(pricingTable).where(and(
      isNull(pricingTable.orgId),
      eq(pricingTable.provider, price.provider),
      eq(pricingTable.model, price.model),
    ))
  }
}

async function seedOrg(orgNumber: number, definition: (typeof demoOrgs)[number]) {
  const [org] = await db.insert(orgs).values({
    name: definition.name,
    timezone: definition.timezone,
    currency: 'USD',
    status: 'active',
  }).returning()

  const addUser = async (role: 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor', label: string): Promise<SeedUser> => {
    const [user] = await db.insert(users).values({
      orgId: org.id,
      email: `${label.toLowerCase().replace(/ /g, '.')}@${definition.name.toLowerCase().replace(/ /g, '')}.test`,
      passwordHash: '$2b$12$development.seed.hash.not.for.production',
      role,
    }).returning({ id: users.id, email: users.email })
    return user
  }

  const admins = await Promise.all([addUser('org_admin', 'admin one'), addUser('org_admin', 'admin two')])
  const leads = await Promise.all([addUser('team_lead', 'lead alpha'), addUser('team_lead', 'lead beta')])
  const developers = await Promise.all(Array.from({ length: 5 }, (_, index) => addUser('developer', `developer ${index + 1}`)))
  await addUser('finance', 'finance')
  await addUser('auditor', 'auditor')

  const [platformTeam] = await db.insert(teams).values({ orgId: org.id, name: 'Platform', teamLeadId: leads[0].id }).returning()
  const [productTeam] = await db.insert(teams).values({ orgId: org.id, name: 'Product', teamLeadId: leads[1].id }).returning()
  const [platformOpsTeam] = await db.insert(teams).values({
    orgId: org.id, name: 'Platform Operations', parentTeamId: platformTeam.id, teamLeadId: leads[1].id,
  }).returning()
  const seededTeams = [platformTeam, productTeam, platformOpsTeam]

  const statusByTeam = [
    ['active', 'pending_approval'],
    ['paused', 'active'],
    ['active', 'pending_approval'],
  ] as const
  const seededAgents: SeedAgent[] = []

  for (const [teamIndex, team] of seededTeams.entries()) {
    for (const [agentIndex, status] of statusByTeam[teamIndex].entries()) {
      const [agent] = await db.insert(agents).values({
        orgId: org.id,
        teamId: team.id,
        ownerUserId: developers[(teamIndex * 2 + agentIndex) % developers.length].id,
        name: `${team.name} ${agentIndex === 0 ? 'Assistant' : 'Worker'}`,
        apiKey: `seed_${orgNumber}_${teamIndex}_${agentIndex}_${faker.string.alphanumeric(16)}`,
        status,
        approvedAt: status === 'pending_approval' ? null : new Date(),
        approvedBy: status === 'pending_approval' ? null : team.teamLeadId,
      }).returning({ id: agents.id, teamId: agents.teamId, status: agents.status })
      if (!agent.teamId) throw new Error(`Seeded agent ${agent.id} is missing a team`)
      seededAgents.push({ id: agent.id, teamId: agent.teamId, status: agent.status })

      if (status !== 'pending_approval') {
        await db.insert(agentApprovals).values({
          orgId: org.id,
          agentId: agent.id,
          requestedBy: developers[(teamIndex * 2 + agentIndex) % developers.length].id,
          approvedBy: team.teamLeadId ?? admins[0].id,
          status: 'approved',
          decidedAt: new Date(),
          expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        })
      }
    }
  }

  await db.insert(budgets).values({ orgId: org.id, scope: 'org', scopeId: org.id, limitAmount: '20000.0000', currency: 'USD', period: 'monthly', resetTimezone: org.timezone })
  const teamLimits = ['5000.0000', '4500.0000', '3000.0000']
  const teamBudgets: Array<{ id: string; teamId: string }> = []
  for (const [index, team] of seededTeams.entries()) {
    const [teamBudget] = await db.insert(budgets).values({
      orgId: org.id, scope: 'team', scopeId: team.id, limitAmount: teamLimits[index], currency: 'USD', period: 'monthly', resetTimezone: org.timezone,
    }).returning({ id: budgets.id, scopeId: budgets.scopeId })
    teamBudgets.push({ id: teamBudget.id, teamId: team.id })
  }
  for (const agent of seededAgents.filter((item) => item.status === 'active')) {
    await db.insert(budgets).values({ orgId: org.id, scope: 'agent', scopeId: agent.id, limitAmount: '1200.0000', currency: 'USD', period: 'monthly', resetTimezone: org.timezone })
  }
  await db.insert(budgetRequests).values({
    orgId: org.id, budgetId: teamBudgets[0].id, requestedBy: developers[0].id, requestedAmount: '5500.0000', status: 'pending',
  })

  const taskRows = await db.insert(agentTasks).values([
    { orgId: org.id, agentId: seededAgents[0].id, status: 'completed', outcome: 'success', totalCost: '0.2500', totalCalls: 3, endedAt: new Date() },
    { orgId: org.id, agentId: seededAgents[2].id, status: 'failed', outcome: 'fail', totalCost: '0.1800', totalCalls: 3, endedAt: new Date() },
    { orgId: org.id, agentId: seededAgents[4].id, status: 'running', outcome: 'pending', totalCost: '0.1200', totalCalls: 3 },
  ]).returning({ taskId: agentTasks.taskId })

  const usageRows = Array.from({ length: 18 }, (_, index) => {
    const agent = seededAgents[index % seededAgents.length]
    const price = prices[index % prices.length]
    const inputTokens = 400 + index * 37
    const outputTokens = 120 + index * 19
    const cost = (inputTokens / 1000) * price.input + (outputTokens / 1000) * price.output
    return {
      orgId: org.id,
      agentId: agent.id,
      taskId: index < 9 ? taskRows[Math.floor(index / 3)].taskId : null,
      stepNumber: index < 9 ? (index % 3) + 1 : null,
      provider: price.provider,
      model: price.model,
      callType: index % 4 === 0 ? 'embedding' as const : 'llm_call' as const,
      environment: (['dev', 'staging', 'prod'] as const)[index % 3],
      inputTokens,
      outputTokens,
      costUsd: money(cost),
      latencyMs: 180 + index * 11,
      status: index % 11 === 0 ? 'timeout' as const : 'success' as const,
      isTest: index % 7 === 0,
      cacheHit: index % 6 === 0,
      originalTokenCount: inputTokens + 80,
      optimizedTokenCount: inputTokens,
    }
  })
  await db.insert(usageEvents).values(usageRows)

  const alertRows = await db.insert(alerts).values([
    { orgId: org.id, teamId: platformTeam.id, type: 'budget', thresholdPercent: '80.00', active: true },
    { orgId: org.id, teamId: productTeam.id, type: 'budget', thresholdPercent: '90.00', active: true },
    { orgId: org.id, agentId: seededAgents[0].id, type: 'budget', thresholdPercent: '95.00', active: true },
  ]).returning({ id: alerts.id })
  await db.insert(alertHistory).values({ orgId: org.id, alertId: alertRows[0].id, acknowledgedBy: admins[0].id, acknowledgedAt: new Date(), status: 'acknowledged' })

  await db.insert(auditLog).values([
    { orgId: org.id, actorUserId: admins[0].id, eventType: 'agent_approved', targetType: 'agent', targetId: seededAgents[0].id, metadata: { source: 'seed' } },
    { orgId: org.id, actorUserId: admins[1].id, eventType: 'budget_changed', targetType: 'budget', targetId: teamBudgets[0].id, metadata: { limit: 5000 } },
    { orgId: org.id, actorUserId: admins[0].id, eventType: 'pricing_edited', targetType: 'pricing', targetId: null, metadata: { provider: 'openai' } },
  ])
  await db.insert(accessGrants).values({ orgId: org.id, grantedTo: systemSuperAdminId, grantedBy: admins[0].id, reason: 'Seeded support-access approval', active: true })

  return { org, admins, leads, teams: seededTeams }
}

async function seed() {
  await removeExistingDemoData()
  await db.insert(pricingTable).values(prices.map((price) => ({
    provider: price.provider,
    model: price.model,
    inputPricePer1k: money(price.input),
    outputPricePer1k: money(price.output),
    currency: 'USD',
    effectiveDate: new Date('2026-01-01T00:00:00Z'),
  })))

  const results = []
  for (const [index, definition] of demoOrgs.entries()) results.push(await seedOrg(index + 1, definition))
  await db.insert(pricingTable).values({
    orgId: results[0].org.id,
    provider: 'openai', model: 'gpt-4o', inputPricePer1k: '0.0040', outputPricePer1k: '0.0120', currency: 'USD', effectiveDate: new Date('2026-01-01T00:00:00Z'),
  })

  console.log(`Seeded ${results.length} organizations, ${results.length * 11} users, ${results.length * 3} teams, ${results.length * 6} agents, and ${results.length * 18} usage events.`)
}

seed()
  .catch((error) => { console.error('Seed failed:', error); process.exitCode = 1 })
  .finally(async () => { await client.end() })
