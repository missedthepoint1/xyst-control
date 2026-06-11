import { contextBridge, ipcRenderer } from 'electron';

const api = {
  list: () => ipcRenderer.invoke('camera:list'),
  states: () => ipcRenderer.invoke('camera:states'),
  connect: (id: string) => ipcRenderer.invoke('camera:connect', id),
  record: (id: string, start: boolean) => ipcRenderer.invoke('camera:record', id, start),
  recordAll: (start: boolean) => ipcRenderer.invoke('camera:recordAll', start),
  setControl: (id: string, control: string, value: string | number) =>
    ipcRenderer.invoke('camera:setControl', id, control, value),
  addCamera: (profile: unknown) => ipcRenderer.invoke('camera:add', profile),
  onState: (cb: (id: string, state: unknown) => void) => {
    const h = (_e: unknown, id: string, state: unknown) => cb(id, state);
    ipcRenderer.on('camera:state', h);
    return () => ipcRenderer.off('camera:state', h);
  },
  presets: (id: string) => ipcRenderer.invoke('camera:presets', id),
  savePreset: (id: string, name: string) => ipcRenderer.invoke('camera:savePreset', id, name),
  recallPreset: (id: string, presetId: string) => ipcRenderer.invoke('camera:recallPreset', id, presetId),
  deletePreset: (id: string, presetId: string) => ipcRenderer.invoke('camera:deletePreset', id, presetId),
  onPresets: (cb: (id: string, presets: unknown) => void) => {
    const h = (_e: unknown, id: string, presets: unknown) => cb(id, presets);
    ipcRenderer.on('camera:presets', h);
    return () => ipcRenderer.off('camera:presets', h);
  },
  removeCamera: (id: string) => ipcRenderer.invoke('camera:remove', id),
  setVideoSource: (id: string, video: { type: string; deviceId?: string }) =>
    ipcRenderer.invoke('camera:setVideoSource', id, video),
  getApiBase: () => ipcRenderer.invoke('app:apiBase') as Promise<string>,
  onRemoved: (cb: (id: string) => void) => {
    const h = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('camera:removed', h);
    return () => ipcRenderer.off('camera:removed', h);
  },
};

contextBridge.exposeInMainWorld('xyst', api);
export type XystApi = typeof api;
