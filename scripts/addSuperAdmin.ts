import 'dotenv/config'
import bcrypt from 'bcrypt'
import { count } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { superAdmins } from '../src/schemas'

const [, , emailArg, passwordArg] = process.argv
if (!emailArg || !passwordArg) throw new Error('Usage: npm run add:superadmin -- <email> <password>')
if (passwordArg.length < 8) throw new Error('Password must be at least 8 characters')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required')

const client = postgres(process.env.DATABASE_URL, { max: 1 })
const db = drizzle(client)

async function addSuperAdmin() {
  const [{ total }] = await db.select({ total: count() }).from(superAdmins)
  if (total >= 3) throw new Error('Super Admin cap reached (3); remove an existing admin before adding another')
  const passwordHash = await bcrypt.hash(passwordArg, 12)
  await db.insert(superAdmins).values({ email: emailArg.trim().toLowerCase(), passwordHash, createdBy: null })
  const [{ total: newTotal }] = await db.select({ total: count() }).from(superAdmins)
  console.log(`Super Admin added. Total Super Admins: ${newTotal}`)
}

addSuperAdmin().finally(() => client.end())
