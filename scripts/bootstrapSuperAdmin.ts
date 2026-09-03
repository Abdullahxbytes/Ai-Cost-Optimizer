import 'dotenv/config';
import { client } from '../src/config/database';
import { superAdminsService } from '../src/features/super-admins/super-admins.service';

const [, , emailArg, passwordArg] = process.argv;
if (!emailArg || !passwordArg) {
  throw new Error('Usage: npm run bootstrap:superadmin -- <email> <password>');
}
if (passwordArg.length < 8) throw new Error('Password must be at least 8 characters');
async function bootstrap() {
  const admin = await superAdminsService.bootstrap(emailArg, passwordArg);
  console.log(`Bootstrapped Super Admin ${admin.email} (${admin.id})`);
}

bootstrap().finally(() => client.end());
