import { teamsService } from '../features/teams/teams.service';

/**
 * Scheduler hook for the 15-day archived-team retention policy. It is deliberately
 * callable on demand until the project has a shared recurring-jobs scheduler.
 */
export async function purgeExpiredTeamArchives(now = new Date()) {
  return teamsService.purgeExpiredArchives(now);
}
