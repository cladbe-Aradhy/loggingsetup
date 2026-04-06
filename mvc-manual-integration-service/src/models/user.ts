export type UserRole = 'admin' | 'member';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface CreateUserInput {
  name: string;
  email: string;
  role?: UserRole;
}
