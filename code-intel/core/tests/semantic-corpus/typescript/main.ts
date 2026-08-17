export class UserService {
  constructor(private readonly name: string) {}
  greet(): string { return `Hello, ${this.name}`; }
}
export function createUser(name: string): UserService { return new UserService(name); }
export interface IUser { id: string; }
export enum Status { Active, Inactive }
const internalHelper = () => 1;
