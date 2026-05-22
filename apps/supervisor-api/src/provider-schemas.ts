import { z } from 'zod';

import {
  agentBackendIds,
} from '../../../packages/shared/src/index';

export const agentBackendIdSchema = z.enum(agentBackendIds);
