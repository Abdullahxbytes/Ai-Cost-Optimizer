import 'dotenv/config';
import { client } from '../src/config/database';
import { superAdminsService } from '../src/features/super-admins/super-admins.service';

const [, , emailArg, passwordArg] = process.argv;
if (!emailArg || !passwordArg)
  throw new Error('Usage: npm run add:superadmin -- <email> <password>');
if (passwordArg.length < 8) throw new Error('Password must be at least 8 characters');
async function addSuperAdmin() {
  // Deprecated for routine additions; use POST /super-admins after the initial bootstrap.
  const admin = await superAdminsService.create(null, emailArg, passwordArg);
  console.log(`Super Admin added: ${admin.email}`);
}

addSuperAdmin().finally(() => client.end());
