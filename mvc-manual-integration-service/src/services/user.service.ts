import { randomUUID } from 'node:crypto';
import { AppError } from '../models/app-error';
import { CreateUserInput, User } from '../models/user';

const users = new Map<string, User>();

const seedUsers: User[] = [
  {
    id: 'user-1',
    name: 'Aarav Sharma',
    email: 'aarav@example.com',
    role: 'admin'
  },
  {
    id: 'user-2',
    name: 'Diya Singh',
    email: 'diya@example.com',
    role: 'member'
  }
];

seedUsers.forEach((user) => {
  users.set(user.id, user);
});

export class UserService {
  list() {
    return Array.from(users.values());
  }

  getById(id: string) {
    const user = users.get(id);

    if (!user) {
      throw new AppError('User not found', 404, 'USER_NOT_FOUND');
    }

    return user;
  }

  create(input: CreateUserInput) {
    const normalizedEmail = input.email.trim().toLowerCase();
    const exists = Array.from(users.values()).some((user) => user.email === normalizedEmail);

    if (exists) {
      throw new AppError('Email already exists', 409, 'USER_EMAIL_CONFLICT');
    }

    const user: User = {
      id: randomUUID(),
      name: input.name.trim(),
      email: normalizedEmail,
      role: input.role || 'member'
    };

    users.set(user.id, user);
    return user;
  }
}
