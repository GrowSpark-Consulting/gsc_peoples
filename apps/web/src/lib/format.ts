const INR = '₹';

/** Indian digit grouping, e.g. 482000 -> "₹ 4,82,000". */
export function formatINR(value: number, maximumFractionDigits = 0): string {
  const body = new Intl.NumberFormat('en-IN', { maximumFractionDigits }).format(Math.abs(value));
  return `${value < 0 ? '-' : ''}${INR} ${body}`;
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** Short Indian form: 4820000 -> "₹ 48.2 L", 12000000 -> "₹ 1.2 Cr". Below 1 lakh uses full grouping. */
export function formatINRShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${INR} ${trim(abs / 1e7)} Cr`;
  if (abs >= 1e5) return `${sign}${INR} ${trim(abs / 1e5)} L`;
  return formatINR(value);
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-IN').format(value);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]!.charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}
