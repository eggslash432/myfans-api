import { Injectable } from '@nestjs/common';
import { User, Role } from './user.entity';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  private users: User[] = [];

  async findByEmail(email: string): Promise<User | undefined> {
    return this.users.find(u => u.email === email);
  }

  async create(email: string, passwordHash: string, role: Role): Promise<User> {
    const user: User = {
      id: crypto.randomUUID(),
      email,
      passwordHash,
      role,
      createdAt: new Date(),
    };
    this.users.push(user);
    return user;
  }

  async findById(id: string): Promise<User | undefined> {
    return this.users.find(u => u.id === id);
  }
}
