export type AgentStatus = 'pending_approval' | 'active' | 'paused' | 'pending_deletion';
export type Agent = {
  id: string;
  name: string;
  status: AgentStatus;
  teamId: string | null;
  teamName: string | null;
  ownerUserId: string;
  ownerEmail: string | null;
  approvalStatus?: string;
};
export type Team = {
  id: string;
  name: string;
  parentTeamId: string | null;
  teamLeadId: string | null;
  teamLeadEmail: string | null;
};
export type Budget = {
  id: string;
  scope: 'org' | 'team' | 'agent';
  scopeId: string;
  scopeName: string | null;
  limitAmount: number;
  period: 'daily' | 'monthly';
  currentSpend: number;
  percentUsed: number;
};
export type AlertDefinition = {
  id: string;
  orgId: string;
  teamId: string | null;
  agentId: string | null;
  type: 'budget' | 'spike' | 'runaway';
  thresholdPercent: number;
  active: boolean;
};
export type AlertHistory = {
  id: string;
  alertType: 'budget' | 'spike' | 'runaway';
  scope: 'org' | 'team' | 'agent';
  scopeName: string | null;
  thresholdPercent: string | number;
  triggeredAt: string;
  status: 'triggered' | 'acknowledged' | 'resolved';
  acknowledgedBy: string | null;
  acknowledgedByEmail: string | null;
  acknowledgedAt: string | null;
};
export type Notification = {
  id: string;
  eventType: string;
  severity: string;
  priority: string;
  message: string;
  read: boolean;
  createdAt: string;
};
