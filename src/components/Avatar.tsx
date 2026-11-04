const colors = ['#c1cfbb', '#ead8bc', '#c5d8da', '#dac9c5', '#d0ccdf', '#d9d3b6', '#c4d0cd', '#d7beab', '#bfd1de', '#d8c8b4'];
export function Avatar({ preset = 0, size = 38, anonymous = false }: { preset?: number; size?: number; anonymous?: boolean }) {
  return <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={anonymous ? '匿名头像' : `共读头像 ${preset + 1}`} className="avatar">
    <circle cx="32" cy="32" r="32" fill={anonymous ? '#dedbd3' : colors[preset % 10]} />
    {anonymous ? <><circle cx="32" cy="25" r="10" fill="#9b9c93"/><path d="M13 57c1-18 37-18 38 0" fill="#9b9c93"/></> : <>
      <path d="M12 64c0-21 40-21 40 0" fill={['#465c4b', '#7a6850', '#4e6970'][preset % 3]}/><path d="m23 48 9 10 9-10" fill="#f6ead7"/>
      <circle cx="32" cy="18" r="10" fill="#393c34"/><circle cx="32" cy="32" r="18" fill="#f1d6af"/>
      <path d="M14 31c-2-28 38-28 36 0-7-1-12-7-18-14-5 8-10 11-18 14" fill="#393c34"/>
      <circle cx="25" cy="33" r="1.4" fill="#373d32"/><circle cx="39" cy="33" r="1.4" fill="#373d32"/>
      <path d="M28 41q4 3 8 0" stroke="#ac775d" fill="none" strokeWidth="1.4"/><path d="m22 15 20 0" stroke="#f0e3be" strokeWidth="2"/>
    </>}
  </svg>;
}
