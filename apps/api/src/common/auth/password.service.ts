import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/** argon2id password hashing (PRD §25.2, ARCHITECTURE §8). OWASP-recommended parameters. */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false; // malformed hash
  }
}

@Injectable()
export class PasswordService {
  /** Verified against when the user does not exist, so a miss takes as long as a wrong password. */
  private dummy: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hashPassword(password);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verifyPassword(passwordHash, password);
  }

  async verifyAgainstNothing(password: string): Promise<void> {
    this.dummy ??= hashPassword('kavach-timing-equaliser');
    await verifyPassword(await this.dummy, password);
  }
}
