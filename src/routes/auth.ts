import { FastifyPluginAsync } from 'fastify'
import bcrypt from 'bcrypt'
import { eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'
import { generateSecret, generateURI, verify } from 'otplib'
import QRCode from 'qrcode'
import { z } from 'zod'
import { db } from '../config/database'
import { env } from '../config/env'
import { orgs, superAdmins, users } from '../schemas'
import { AuthError, ValidationError } from '../utils/errors'

const signupSchema = z.object({
  orgName: z.string().trim().min(2), email: z.string().trim().email(), password: z.string().min(8),
  timezone: z.string().trim().min(1).optional(),
})
const loginSchema = z.object({ email: z.string().trim().email(), password: z.string().min(1) })
const verificationSchema = z.object({ code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits') })

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body)
  if (!parsed.success) throw new ValidationError(parsed.error.issues[0]?.message ?? 'Invalid request body')
  return parsed.data
}

type PendingTokenPayload = { user_id: string; org_id: string | null; purpose: '2fa_pending' }
type AuthPrincipal = { id: string; orgId: string | null; email: string; role: 'super_admin' | 'org_admin' | 'team_lead' | 'developer' | 'finance' | 'auditor'; twoFactorSecret: string | null }

function getPendingToken(authorization: string | undefined): PendingTokenPayload {
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]
  if (!token) throw new AuthError('Invalid or expired pending token')
  try {
    const payload = jwt.verify(token, env.JWT_SECRET)
    if (typeof payload === 'string' || payload.purpose !== '2fa_pending' || typeof payload.user_id !== 'string' || (typeof payload.org_id !== 'string' && payload.org_id !== null)) {
      throw new AuthError('Invalid or expired pending token')
    }
    return { user_id: payload.user_id, org_id: payload.org_id, purpose: '2fa_pending' }
  } catch (error) {
    if (error instanceof AuthError) throw error
    throw new AuthError('Invalid or expired pending token')
  }
}

async function getPendingPrincipal(pending: PendingTokenPayload): Promise<AuthPrincipal | undefined> {
  if (pending.org_id === null) {
    const [admin] = await db.select({ id: superAdmins.id, email: superAdmins.email, twoFactorSecret: superAdmins.twoFactorSecret })
      .from(superAdmins).where(eq(superAdmins.id, pending.user_id)).limit(1)
    return admin && { ...admin, orgId: null, role: 'super_admin' }
  }
  const [user] = await db.select({ id: users.id, orgId: users.orgId, email: users.email, role: users.role, twoFactorSecret: users.twoFactorSecret })
    .from(users).where(eq(users.id, pending.user_id)).limit(1)
  return user && user.orgId === pending.org_id ? user : undefined
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post('/signup', async (request, reply) => {
    const body = parseBody(signupSchema, request.body)
    const email = body.email.toLowerCase()
    const passwordHash = await bcrypt.hash(body.password, 12)
    const created = await db.transaction(async (tx) => {
      const [org] = await tx.insert(orgs).values({ name: body.orgName, timezone: body.timezone ?? 'UTC', currency: 'USD', status: 'active' }).returning({ id: orgs.id })
      const [user] = await tx.insert(users).values({ orgId: org.id, email, passwordHash, role: 'org_admin' }).returning({ id: users.id, email: users.email })
      return { orgId: org.id, userId: user.id, email: user.email }
    })
    return reply.status(201).send(created)
  })

  app.post('/login', async (request) => {
    const body = parseBody(loginSchema, request.body)
    const matches = await db.select({ userId: users.id, orgId: users.orgId, passwordHash: users.passwordHash, twoFactorSecret: users.twoFactorSecret, orgStatus: orgs.status })
      .from(users).innerJoin(orgs, eq(users.orgId, orgs.id)).where(eq(users.email, body.email.toLowerCase())).limit(2)
    if (matches.length === 1) {
      if (matches[0].orgStatus !== 'active' || !await bcrypt.compare(body.password, matches[0].passwordHash)) throw new AuthError('Invalid credentials')
      const pendingToken = jwt.sign({ user_id: matches[0].userId, org_id: matches[0].orgId, purpose: '2fa_pending' }, env.JWT_SECRET, { expiresIn: '5m' })
      return { pendingToken, twoFactorConfigured: matches[0].twoFactorSecret !== null }
    }
    if (matches.length > 1) throw new AuthError('Invalid credentials')
    const [admin] = await db.select({ id: superAdmins.id, passwordHash: superAdmins.passwordHash, twoFactorSecret: superAdmins.twoFactorSecret })
      .from(superAdmins).where(eq(superAdmins.email, body.email.toLowerCase())).limit(1)
    if (!admin || !await bcrypt.compare(body.password, admin.passwordHash)) throw new AuthError('Invalid credentials')
    const pendingToken = jwt.sign({ user_id: admin.id, org_id: null, purpose: '2fa_pending' }, env.JWT_SECRET, { expiresIn: '5m' })
    return { pendingToken, twoFactorConfigured: admin.twoFactorSecret !== null }
  })

  app.post('/2fa/setup', async (request) => {
    const pending = getPendingToken(request.headers.authorization)
    const user = await getPendingPrincipal(pending)
    if (!user) throw new AuthError('Invalid or expired pending token')
    if (user.twoFactorSecret) throw new ValidationError('2FA already configured, use /auth/2fa/verify')

    const secret = generateSecret()
    if (user.orgId === null) await db.update(superAdmins).set({ twoFactorSecret: secret }).where(eq(superAdmins.id, user.id))
    else await db.update(users).set({ twoFactorSecret: secret, updatedAt: new Date() }).where(eq(users.id, user.id))
    const otpAuthUrl = generateURI({ issuer: 'AICostOptimizer', label: user.email, secret })
    const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl)
    return { qrCodeDataUrl, manualEntryKey: secret }
  })

  app.post('/2fa/verify', async (request) => {
    const pending = getPendingToken(request.headers.authorization)
    const { code } = parseBody(verificationSchema, request.body)
    const user = await getPendingPrincipal(pending)
    if (!user || !user.twoFactorSecret) {
      throw new ValidationError('Complete /auth/2fa/setup first')
    }
    if (!(await verify({ token: code, secret: user.twoFactorSecret })).valid) throw new AuthError('Invalid code')
    const token = jwt.sign({ user_id: user.id, org_id: user.orgId, role: user.role }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] })
    return { token, user: { id: user.id, email: user.email, role: user.role, orgId: user.orgId } }
  })
}
