import type { CameraState } from '@xyst/core';
import { RecButton } from './RecButton.js';
import { IsoControl } from './controls/IsoControl.js';
import { ShutterControl } from './controls/ShutterControl.js';
import { IrisControl } from './controls/IrisControl.js';
import { WbControl } from './controls/WbControl.js';
import { NdControl } from './controls/NdControl.js';

const statusColor: Record<string, string> = {
  connected: 'var(--ok)', connecting: 'var(--accent)',
  error: 'var(--rec)', disconnected: 'var(--muted)',
};

export function CameraPanel({ state }: { state: CameraState }) {
  const id = state.id;
  const set = (control: string, value: string | number) =>
    window.xyst.setControl(id, control, value);
  return (
    <section style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 16,
      outline: state.record.recording ? '2px solid var(--rec)' : 'none',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 650 }}>{state.model ?? id}</div>
          <div style={{ fontSize: 12, color: statusColor[state.status] ?? 'var(--muted)' }}>
            {state.status}{state.lastError ? ` · ${state.lastError}` : ''}
          </div>
        </div>
        <RecButton
          recording={state.record.recording}
          onToggle={() => window.xyst.record(id, !state.record.recording)}
        />
      </header>

      <div style={{ display: 'grid', gap: 10 }}>
        {state.controls.iso?.available && <IsoControl c={state.controls.iso} onSet={(v) => set('iso', v)} />}
        {state.controls.shutter?.available && <ShutterControl c={state.controls.shutter} onSet={(v) => set('shutter', v)} />}
        {state.controls.iris?.available && <IrisControl c={state.controls.iris} onSet={(v) => set('iris', v)} />}
        {state.controls.wb?.available && (
          <WbControl
            wb={state.controls.wb} kelvin={state.controls.wbKelvin}
            onSetWb={(v) => set('wb', v)} onSetKelvin={(v) => set('wbKelvin', v)}
          />
        )}
        {state.controls.nd?.available && <NdControl c={state.controls.nd} onSet={(v) => set('nd', v)} />}
      </div>
    </section>
  );
}
