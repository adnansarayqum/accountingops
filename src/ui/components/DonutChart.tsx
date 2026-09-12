import { cn } from '../cn';

export interface DonutSegment {
  label: string;
  value: number;
  /** Stroke colour. Passed explicitly so callers keep control of the palette. */
  colour: string;
}

/**
 * A small inline-SVG donut. Deliberately not a charting library: the whole
 * chart is four arcs and a number, and pulling in a dependency for that
 * would cost more than it's worth. Stroke-dasharray on a circle draws each
 * arc; the offsets accumulate so the segments sit end to end.
 *
 * Accessible as a labelled figure with the underlying numbers listed next
 * to it, so nothing is conveyed by colour alone.
 */
export function DonutChart({ segments, centreValue, centreLabel, className }: { segments: DonutSegment[]; centreValue: string | number; centreLabel: string; className?: string }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <svg viewBox="0 0 100 100" className={cn('h-full w-full -rotate-90', className)} role="img" aria-label={`${centreValue} ${centreLabel}`}>
      {/* The track, so an empty practice still reads as a chart rather than a blank square. */}
      <circle cx="50" cy="50" r={radius} fill="none" stroke="currentColor" strokeWidth="11" className="text-slate-100" />
      {total > 0 &&
        segments.map((segment) => {
          if (segment.value === 0) return null;
          const length = (segment.value / total) * circumference;
          const dash = <circle key={segment.label} cx="50" cy="50" r={radius} fill="none" stroke={segment.colour} strokeWidth="11" strokeDasharray={`${length} ${circumference - length}`} strokeDashoffset={-offset} strokeLinecap="butt" />;
          offset += length;
          return dash;
        })}
    </svg>
  );
}
