export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Direction = "horizontal" | "vertical";

export type Constraint =
  | { type: "length"; value: number }
  | { type: "min"; value: number }
  | { type: "percentage"; value: number }
  | { type: "fill"; value?: number };

export const length = (value: number): Constraint => ({ type: "length", value });
export const min = (value: number): Constraint => ({ type: "min", value });
export const percentage = (value: number): Constraint => ({ type: "percentage", value });
export const fill = (value = 1): Constraint => ({ type: "fill", value });

export function rect(width: number, height: number, x = 0, y = 0): Rect {
  return {
    x,
    y,
    width: Math.max(0, width),
    height: Math.max(0, height)
  };
}

export function pad(area: Rect, top: number, right = top, bottom = top, left = right): Rect {
  const x = area.x + Math.max(0, left);
  const y = area.y + Math.max(0, top);
  const width = Math.max(0, area.width - Math.max(0, left) - Math.max(0, right));
  const height = Math.max(0, area.height - Math.max(0, top) - Math.max(0, bottom));
  return { x, y, width, height };
}

export function center(area: Rect, preferredWidth: number, preferredHeight: number): Rect {
  const width = Math.min(area.width, Math.max(0, preferredWidth));
  const height = Math.min(area.height, Math.max(0, preferredHeight));
  return {
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    width,
    height
  };
}

export function split(area: Rect, direction: Direction, constraints: Constraint[]): Rect[] {
  const total = direction === "horizontal" ? area.width : area.height;
  const sizes = resolveSizes(total, constraints);
  let offset = 0;

  return sizes.map((size) => {
    const next = direction === "horizontal"
      ? { x: area.x + offset, y: area.y, width: size, height: area.height }
      : { x: area.x, y: area.y + offset, width: area.width, height: size };
    offset += size;
    return next;
  });
}

function resolveSizes(total: number, constraints: Constraint[]): number[] {
  const sizes = constraints.map(() => 0);
  let remaining = Math.max(0, total);
  const deferred: Array<{ index: number; min: number; weight: number }> = [];

  constraints.forEach((constraint, index) => {
    if (constraint.type === "length") {
      const size = Math.min(remaining, Math.max(0, constraint.value));
      sizes[index] = size;
      remaining -= size;
    } else if (constraint.type === "percentage") {
      const size = Math.min(remaining, Math.floor(Math.max(0, total) * Math.max(0, constraint.value) / 100));
      sizes[index] = size;
      remaining -= size;
    } else if (constraint.type === "min") {
      deferred.push({ index, min: Math.max(0, constraint.value), weight: 1 });
    } else {
      deferred.push({ index, min: 0, weight: Math.max(1, constraint.value ?? 1) });
    }
  });

  for (const entry of deferred) {
    const size = Math.min(remaining, entry.min);
    sizes[entry.index] = size;
    remaining -= size;
  }

  const weightTotal = deferred.reduce((totalWeight, entry) => totalWeight + entry.weight, 0);
  deferred.forEach((entry, offset) => {
    if (remaining <= 0 || weightTotal <= 0) {
      return;
    }
    const share = offset === deferred.length - 1
      ? remaining
      : Math.floor(remaining * entry.weight / weightTotal);
    sizes[entry.index] += share;
    remaining -= share;
  });

  return sizes;
}
