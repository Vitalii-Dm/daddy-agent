import { createLogger } from '@shared/utils/logger';
import { ipcMain } from 'electron';

import { initializeConfigHandlers, registerConfigHandlers, removeConfigHandlers } from './config';
import {
  initializeContextHandlers,
  registerContextHandlers,
  removeContextHandlers,
} from './context';
import {
  initializeCrossTeamHandlers,
  registerCrossTeamHandlers,
  removeCrossTeamHandlers,
} from './crossTeam';
import {
  initializeHttpServerHandlers,
  registerHttpServerHandlers,
  removeHttpServerHandlers,
} from './httpServer';
import {
  initializeProjectHandlers,
  registerProjectHandlers,
  removeProjectHandlers,
} from './projects';
import {
  initializeSessionHandlers,
  registerSessionHandlers,
  removeSessionHandlers,
} from './sessions';
import { initializeSshHandlers, registerSshHandlers, removeSshHandlers } from './ssh';
import {
  initializeSubagentHandlers,
  registerSubagentHandlers,
  removeSubagentHandlers,
} from './subagents';
import { initializeTeamHandlers, registerTeamHandlers, removeTeamHandlers } from './teams';
import { registerUtilityHandlers, removeUtilityHandlers } from './utility';
import { registerValidationHandlers, removeValidationHandlers } from './validation';
import { registerWindowHandlers, removeWindowHandlers } from './window';

import type {
  BoardTaskActivityDetailService,
  BoardTaskActivityService,
  BoardTaskExactLogDetailService,
  BoardTaskExactLogsService,
  BoardTaskLogStreamService,
  BranchStatusService,
  MemberStatsComputer,
  ServiceContext,
  ServiceContextRegistry,
  SshConnectionManager,
  TeamDataService,
  TeammateToolTracker,
  TeamMemberLogsFinder,
  TeamProvisioningService,
} from '../services';
import type { HttpServer } from '../services/infrastructure/HttpServer';
import type { CrossTeamService } from '../services/team/CrossTeamService';
import type { TeamBackupService } from '../services/team/TeamBackupService';

const logger = createLogger('IPC:handlers');

export function initializeIpcHandlers(
  registry: ServiceContextRegistry,
  sshManager: SshConnectionManager,
  teamDataService: TeamDataService,
  teamProvisioningService: TeamProvisioningService,
  teamMemberLogsFinder: TeamMemberLogsFinder,
  memberStatsComputer: MemberStatsComputer,
  boardTaskActivityService: BoardTaskActivityService,
  boardTaskActivityDetailService: BoardTaskActivityDetailService,
  boardTaskLogStreamService: BoardTaskLogStreamService,
  boardTaskExactLogsService: BoardTaskExactLogsService,
  boardTaskExactLogDetailService: BoardTaskExactLogDetailService,
  teammateToolTracker: TeammateToolTracker | undefined,
  branchStatusService: BranchStatusService | undefined,
  contextCallbacks: {
    rewire: (context: ServiceContext) => void;
    full: (context: ServiceContext) => void;
    onClaudeRootPathUpdated: (claudeRootPath: string | null) => Promise<void> | void;
  },
  httpServerDeps?: {
    httpServer: HttpServer;
    startHttpServer: () => Promise<void>;
  },
  crossTeamService?: CrossTeamService,
  teamBackupService?: TeamBackupService
): void {
  initializeProjectHandlers(registry);
  initializeSessionHandlers(registry);
  initializeSubagentHandlers(registry);
  initializeSshHandlers(sshManager, registry, contextCallbacks.rewire);
  initializeContextHandlers(registry, contextCallbacks.rewire);
  initializeTeamHandlers(
    teamDataService,
    teamProvisioningService,
    teamMemberLogsFinder,
    memberStatsComputer,
    teamBackupService,
    teammateToolTracker,
    branchStatusService,
    boardTaskActivityService,
    boardTaskActivityDetailService,
    boardTaskLogStreamService,
    boardTaskExactLogsService,
    boardTaskExactLogDetailService
  );
  initializeConfigHandlers({
    onClaudeRootPathUpdated: contextCallbacks.onClaudeRootPathUpdated,
    onAgentLanguageUpdated: (newLangCode) => {
      void teamProvisioningService.notifyLanguageChange(newLangCode);
    },
  });
  if (httpServerDeps) {
    initializeHttpServerHandlers(httpServerDeps.httpServer, httpServerDeps.startHttpServer);
  }
  if (crossTeamService) {
    initializeCrossTeamHandlers(crossTeamService);
  }

  registerProjectHandlers(ipcMain);
  registerSessionHandlers(ipcMain);
  registerSubagentHandlers(ipcMain);
  registerValidationHandlers(ipcMain);
  registerUtilityHandlers(ipcMain);
  registerConfigHandlers(ipcMain);
  registerSshHandlers(ipcMain);
  registerContextHandlers(ipcMain);
  registerTeamHandlers(ipcMain);
  registerWindowHandlers(ipcMain);
  if (httpServerDeps) {
    registerHttpServerHandlers(ipcMain);
  }
  if (crossTeamService) {
    registerCrossTeamHandlers(ipcMain);
  }

  logger.info('All handlers registered');
}

export function removeIpcHandlers(): void {
  removeProjectHandlers(ipcMain);
  removeSessionHandlers(ipcMain);
  removeSubagentHandlers(ipcMain);
  removeValidationHandlers(ipcMain);
  removeUtilityHandlers(ipcMain);
  removeConfigHandlers(ipcMain);
  removeSshHandlers(ipcMain);
  removeContextHandlers(ipcMain);
  removeTeamHandlers(ipcMain);
  removeWindowHandlers(ipcMain);
  removeHttpServerHandlers(ipcMain);
  removeCrossTeamHandlers(ipcMain);

  logger.info('All handlers removed');
}
