import { useContext } from 'react';

import {
  PluginContext,
  createDefaultPluginContextValue,
} from './plugin-context';

export function usePlugins() {
  return useContext(PluginContext) ?? createDefaultPluginContextValue();
}
