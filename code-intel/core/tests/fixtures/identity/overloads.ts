export function login(token: string): void;
export function login(id: number): void;
export function login(value: string | number): void { void value; }
export class UserService {
  constructor(name: string);
  constructor(id: number);
  constructor(value: string | number) { void value; }
}
export namespace MergeBox { export const value = 1; }
export interface MergeBox { name: string; }
function outer() { function innerLogin(token: string) { void token; } const login = 1; return { innerLogin, login }; }
