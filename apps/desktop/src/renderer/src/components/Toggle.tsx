export function Toggle({ value, onChange }: { value: boolean; onChange(v: boolean): void }) {
  return (
    <button className={`toggle ${value ? 'on' : ''}`} role="switch" aria-checked={value} onClick={() => onChange(!value)}>
      <span />
    </button>
  )
}
