import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { UserEntity } from '../users/users.entity';
import { UsersService } from '../users/users.service';
import { SocialIdentityEntity } from './social-identity.entity';
import type { VerifiedSocialIdentity } from './social-token.service';

@Injectable()
export class SocialIdentityService {
  constructor(
    @InjectRepository(SocialIdentityEntity)
    private readonly identities: Repository<SocialIdentityEntity>,
    private readonly users: UsersService
  ) {}

  async findOrCreate(identity: VerifiedSocialIdentity) {
    const existingIdentity = await this.identities.findOne({
      where: {
        provider: identity.provider,
        providerSubject: identity.subject,
      },
      relations: { user: true },
    });
    if (existingIdentity) {
      return { user: existingIdentity.user, isNewUser: false };
    }

    let user: UserEntity | null = null;
    if (identity.email && identity.emailVerified) {
      user = await this.users.findUserByEmail(identity.email);
    }

    let isNewUser = false;
    if (!user) {
      const username = await this.availableUsername(identity);
      user = await this.users.createUser({
        username,
        email: identity.emailVerified ? identity.email : null,
        password: await bcrypt.hash(randomBytes(32).toString('hex'), 10),
        isAdmin: false,
      });
      isNewUser = true;
    }

    try {
      await this.identities.save(
        this.identities.create({
          provider: identity.provider,
          providerSubject: identity.subject,
          email: identity.email,
          userId: user.id,
        })
      );
    } catch (error: any) {
      if (error?.code !== '23505') throw error;
      const racedIdentity = await this.identities.findOne({
        where: {
          provider: identity.provider,
          providerSubject: identity.subject,
        },
        relations: { user: true },
      });
      if (!racedIdentity) {
        throw new UnauthorizedException('Unable to link social identity');
      }
      return { user: racedIdentity.user, isNewUser: false };
    }

    return { user, isNewUser };
  }

  private async availableUsername(identity: VerifiedSocialIdentity) {
    const emailStem = identity.email?.split('@')[0]?.toLowerCase() ?? '';
    const normalizedStem = emailStem
      .replace(/[^a-z0-9._-]/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40);
    const fallback = `${identity.provider}-${identity.subject.slice(0, 12)}`;
    const base = normalizedStem || fallback;
    if (!(await this.users.findUserByUsername(base))) return base;

    for (let suffix = 2; suffix <= 100; suffix += 1) {
      const candidate = `${base.slice(0, 45)}-${suffix}`;
      if (!(await this.users.findUserByUsername(candidate))) return candidate;
    }
    return `${fallback}-${randomBytes(3).toString('hex')}`;
  }
}
