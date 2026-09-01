
export function interpolate(fromList: number[], toList: number[], f: number): number[] {
  if (fromList.length !== toList.length) {
    throw new Error(`Mismatched interpolation arguments ${fromList}: ${toList}`);
  }
  return fromList.map((value, i) => interpolateNum(value, toList[i], f));
}

export function interpolateNum(fromVal: number, toVal: number, f: number): number {
  return fromVal * (1 - f) + toVal * f;
}
