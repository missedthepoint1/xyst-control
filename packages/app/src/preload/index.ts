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
};

contextBridge.exposeInMainWorld('xyst', api);
export type XystApi = typeof api;
