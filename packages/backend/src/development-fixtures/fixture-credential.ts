import { scryptSync } from 'node:crypto';

export function fixtureCredentialFingerprint(
  username: string,
  password: string
) {
  const salt = `pomi-development-fixture\0${username}`;
  return scryptSync(password, salt, 32).toString('hex');
}
