export function FocusActions({ actions, onAction }: {
  actions: Array<string | number>;
  onAction: (v: string) => void;
}) {
  const has = (a: string) => actions.map(String).includes(a);
  const hold = (a: string) => ({
    onPointerDown: () => onAction(a),
    onPointerUp: () => onAction('stop'),
    onPointerLeave: () => onAction('stop'),
  });
  return (
    <label className="ctl">
      <span className="ctl__label">Focus</span>
      <div className="actions">
        {has('one_shot') && <button type="button" className="act" onClick={() => onAction('one_shot')}>One-Shot AF</button>}
        {has('near') && <button type="button" className="act" {...hold('near')}>Near</button>}
        {has('far') && <button type="button" className="act" {...hold('far')}>Far</button>}
      </div>
    </label>
  );
}
