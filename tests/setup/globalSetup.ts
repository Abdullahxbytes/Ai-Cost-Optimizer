import { execFileSync } from 'child_process';
import path from 'path';
import postgres from 'postgres';
import './env';

export default async function globalSetup() {
  const testUrl = process.env.DATABASE_URL!;
  const parsed = new URL(testUrl);
  const databaseName = decodeURIComponent(parsed.pathname.slice(1));
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';
  const admin = postgres(adminUrl.toString(), { max: 1 });
  try {
    await admin.unsafe(`CREATE DATABASE "${databaseName.replace(/"/g, '""')}"`);
  } catch (error) {
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === '42P04')) throw error;
  } finally {
    await admin.end();
  }
  const testDatabase = postgres(testUrl, { max: 1 });
  try {
    await testDatabase`CREATE EXTENSION IF NOT EXISTS vector`;
  } finally {
    await testDatabase.end();
  }
  execFileSync(process.execPath, [path.resolve(__dirname, '../../node_modules/drizzle-kit/bin.cjs'), 'push', '--force'], {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });
}
