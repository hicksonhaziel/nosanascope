import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import telegramPlugin from '@elizaos/plugin-telegram';
import { nosanascopeCharacter } from './characters/nosanascope.character.ts';
import nosanaOpsPlugin from './plugins/nosana-ops/index.ts';
import { validateNosanaOpsStartupEnv } from './plugins/nosana-ops/config/envValidation.ts';

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  validateNosanaOpsStartupEnv();
  const telegramConfigured = Boolean(runtime.getSetting('TELEGRAM_BOT_TOKEN'));
  logger.info('Initializing NosanaScope');
  logger.info(
    { name: nosanascopeCharacter.name, telegramConfigured },
    'Character loaded'
  );
};

export const projectAgent: ProjectAgent = {
  character: nosanascopeCharacter,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  // Register Telegram at the project-agent level so transport startup
  // is not coupled to character import-time env evaluation.
  plugins: [nosanaOpsPlugin, telegramPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { nosanascopeCharacter as character } from './characters/nosanascope.character.ts';
export default project;
