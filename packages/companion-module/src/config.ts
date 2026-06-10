import type { SomeCompanionConfigField } from '@companion-module/base';

export interface XystConfig { host: string; port: number }

export function getConfigFields(): SomeCompanionConfigField[] {
  return [
    { type: 'textinput', id: 'host', label: 'XYST app host', width: 6, default: '127.0.0.1' },
    { type: 'number', id: 'port', label: 'API port', width: 6, default: 8088, min: 1, max: 65535 },
  ];
}

export const baseUrl = (c: XystConfig): string => `http://${c.host || '127.0.0.1'}:${c.port || 8088}`;
