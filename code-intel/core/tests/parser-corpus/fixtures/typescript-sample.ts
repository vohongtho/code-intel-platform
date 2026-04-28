// TypeScript fixture — parser corpus
export class UserService {
  private name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet(): string {
    return `Hello, ${this.name}`;
  }
}

export function createUser(username: string, role: string): UserService {
  return new UserService(username);
}

export const DEFAULT_ROLE = 'viewer';

export interface IUser {
  id: string;
  username: string;
  role: string;
}

export type UserId = string;

export enum Status {
  Active,
  Inactive,
}

const internalHelper = (x: number) => x * 2;
