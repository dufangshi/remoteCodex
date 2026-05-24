import { useContext } from 'react';

import { PluginContext } from './plugin-context';

export function usePlugins() {
  return useContext(PluginContext);
}
