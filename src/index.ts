import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import starterPlugin from './plugin.ts';
import { nosanascopeCharacter } from './characters/nosanascope.character.ts';
import nosanaOpsPlugin from './plugins/nosana-ops/index.ts';

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing NosanaScope');
  logger.info({ name: nosanascopeCharacter.name }, 'Character loaded');
};

export const projectAgent: ProjectAgent = {
  character: nosanascopeCharacter,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  plugins: [nosanaOpsPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { nosanascopeCharacter as character } from './characters/nosanascope.character.ts';
export default project;
