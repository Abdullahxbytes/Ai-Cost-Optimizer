import { redis } from '../config/redis';
import { getBudgetSpendKey } from '../features/budgets/budget.redis';
import { BudgetScope, budgetsRepository } from '../features/budgets/budgets.repository';
import { AlertRecord, alertsRepository } from '../features/alerts/alerts.repository';
import { notificationsRepository } from '../features/notifications/notifications.repository';

function getScope(alert: AlertRecord): { scope: BudgetScope; scopeId: string } {
  if (alert.agentId) return { scope: 'agent', scopeId: alert.agentId };
  if (alert.teamId) return { scope: 'team', scopeId: alert.teamId };
  return { scope: 'org', scopeId: alert.orgId };
}

export type AlertScanResult = { scanned: number; triggered: number; skippedWithoutBudget: number; deduplicated: number };

export async function alertScanner(): Promise<AlertScanResult> {
  const result: AlertScanResult = { scanned: 0, triggered: 0, skippedWithoutBudget: 0, deduplicated: 0 };
  for (const alert of await alertsRepository.listActiveBudgetAlerts()) {
    result.scanned += 1;
    const { scope, scopeId } = getScope(alert);
    const budget = await budgetsRepository.getBudget(scope, scopeId);
    if (!budget) {
      result.skippedWithoutBudget += 1;
      continue;
    }
    const spend = Number((await redis.get(getBudgetSpendKey(scope, scopeId, budget))) ?? '0');
    if ((spend / budget.limitAmount) * 100 < alert.thresholdPercent) continue;
    // `triggered` is the schema's open/unacknowledged state; acknowledgment closes this dedup gate.
    if (await alertsRepository.hasTriggeredHistory(alert.id)) {
      result.deduplicated += 1;
      continue;
    }
    await alertsRepository.createTriggeredHistory(alert.orgId, alert.id);
    const recipients = await notificationsRepository.findBudgetAlertRecipientIds(alert.orgId);
    const label = await alertsRepository.scopeLabel(alert);
    await notificationsRepository.createBudgetAlertNotifications({
      orgId: alert.orgId,
      userIds: recipients,
      message: `${label} has reached ${((spend / budget.limitAmount) * 100).toFixed(2)}% of its ${budget.period} budget.`,
    });
    result.triggered += 1;
  }
  return result;
}
