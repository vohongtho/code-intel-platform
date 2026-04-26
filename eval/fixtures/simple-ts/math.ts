// Fixture: simple TypeScript project for benchmark evaluation
export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

function internalHelper(x: number): number {
  return x * 2;
}

export class Calculator {
  private history: number[] = [];

  compute(a: number, b: number, op: string): number {
    let result: number;
    if (op === 'add') result = add(a, b);
    else if (op === 'mul') result = multiply(a, b);
    else result = 0;
    this.history.push(result);
    return result;
  }

  getHistory(): number[] {
    return this.history;
  }

  reset(): void {
    this.history = [];
  }
}

export function formatResult(label: string, value: number): string {
  return `${label}: ${internalHelper(value)}`;
}
