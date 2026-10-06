const PATHS = {
  home: ["M3.5 10.5 12 3.5l8.5 7", "M5.5 9v11h13V9", "M10 20v-5h4v5"],
  folder: [
    "M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z",
  ],
  users: [
    "M9 4.5a3.5 3.5 0 1 1 0 7 3.5 3.5 0 0 1 0-7z",
    "M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5",
    "M16 4.8a3.3 3.3 0 0 1 0 6.4",
    "M18 14.8c1.8.7 3 2.5 3.5 5.2",
  ],
  bell: ["M6 16v-5a6 6 0 0 1 12 0v5l1.5 2.5h-15z", "M10 21a2 2 0 0 0 4 0"],
  badge: [
    "M6 5h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z",
    "M9 8.8a2.2 2.2 0 1 1 0 4.4 2.2 2.2 0 0 1 0-4.4z",
    "M5.8 16.5c.6-1.6 1.8-2.5 3.2-2.5s2.6.9 3.2 2.5",
    "M14.5 10h4M14.5 13.5h3",
  ],
  file: [
    "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z",
    "M14 3v5h5",
    "M9 13h6M9 17h4",
  ],
  sliders: [
    "M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12",
    "M16 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM10 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM18 16a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  ],
  logout: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 16l-4-4 4-4", "M6 12h10"],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  alert: ["M12 4 2.8 19.5h18.4z", "M12 10v4.5M12 17.2v.3"],
  clock: ["M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z", "M12 7.5V12l3 2"],
  arrowLeft: ["M19 12H5M11 6l-6 6 6 6"],
  arrowRight: ["M5 12h14M13 6l6 6-6 6"],
  sparkle: [
    "M12 3.5c.6 3.8 2.7 5.9 6.5 6.5-3.8.6-5.9 2.7-6.5 6.5-.6-3.8-2.7-5.9-6.5-6.5 3.8-.6 5.9-2.7 6.5-6.5z",
  ],
  building: [
    "M4 20V6l8-3 8 3v14",
    "M9 20v-4h6v4M8 9h.01M12 9h.01M16 9h.01M8 13h.01M12 13h.01M16 13h.01",
  ],
  calendar: [
    "M6.5 5h11a3 3 0 0 1 3 3v9.5a3 3 0 0 1-3 3h-11a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z",
    "M8 3v4M16 3v4M3.5 10h17",
  ],
  message: ["M4 5h16v11H9l-5 4z"],
  key: ["M8 11a4 4 0 1 1 0 8 4 4 0 0 1 0-8z", "m11 12 9-9M16 7l3 3M14 9l2 2"],
  heart: ["M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"],
  search: ["M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14z", "m20 20-3.5-3.5"],
  upload: ["M12 15V4M7.5 8.5 12 4l4.5 4.5", "M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"],
  edit: ["M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z", "m13.5 6.5 4 4"],
  external: [
    "M14 4h6v6",
    "M20 4 10 14",
    "M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4",
  ],
  menu: ["M4 7h16M4 12h16M4 17h16"],
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 18,
  strokeWidth = 2,
  className = "",
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
