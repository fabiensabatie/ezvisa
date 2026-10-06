const PETALS: Array<[number, number]> = [
  [50, 24],
  [74.7, 42],
  [65.3, 71],
  [34.7, 71],
  [25.3, 42],
];

/** The EzVisa mark: five petals in the accent colour. */
export function Flower({ size = 44 }: { size?: number }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 100 100" width={size} height={size} className="shrink-0">
      {PETALS.map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={19} className="fill-accent" />
      ))}
      <circle cx={50} cy={50} r={13} className="fill-white" />
      <circle cx={50} cy={50} r={6} className="fill-petal" />
    </svg>
  );
}
