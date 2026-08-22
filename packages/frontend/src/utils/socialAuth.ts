import { signIn as googleSignIn } from '@choochmeque/tauri-plugin-google-auth-api';
import type { AppLanguage } from '@pomi/shared';
import { getAppleIdCredential } from 'tauri-plugin-siwa-api';
import { environmentVariables } from '../config/environmentVariables';
import { apiClient } from './apiClient';

type SocialSessionResponse = Awaited<
  ReturnType<typeof apiClient.sessions.createSocial>
>;

async function challenge() {
  const response = await apiClient.sessions.socialChallenge({ body: {} });
  if (response.status !== 201) {
    throw new Error('Unable to begin secure sign-in');
  }
  return response.body;
}

export async function signInWithGoogle(
  language: AppLanguage
): Promise<SocialSessionResponse> {
  if (!environmentVariables.GOOGLE_AUTH_CLIENT_ID) {
    throw new Error('Google sign-in is not configured in this build');
  }
  const authChallenge = await challenge();
  const tokens = await googleSignIn({
    clientId: environmentVariables.GOOGLE_AUTH_CLIENT_ID,
    clientSecret: environmentVariables.GOOGLE_AUTH_CLIENT_SECRET || undefined,
    scopes: ['openid', 'email', 'profile'],
  });
  if (!tokens.idToken) {
    throw new Error('Google did not return an identity token');
  }
  return apiClient.sessions.createSocial({
    body: {
      provider: 'google',
      identityToken: tokens.idToken,
      state: authChallenge.state,
      nonce: authChallenge.nonce,
      language,
    },
  });
}

export async function signInWithApple(
  language: AppLanguage
): Promise<SocialSessionResponse> {
  const authChallenge = await challenge();
  const credential = await getAppleIdCredential({
    scope: ['fullName', 'email'],
    nonce: authChallenge.nonce,
    state: authChallenge.state,
  });
  if (!credential.identityToken) {
    throw new Error('Apple did not return an identity token');
  }
  return apiClient.sessions.createSocial({
    body: {
      provider: 'apple',
      identityToken: credential.identityToken,
      authorizationCode: credential.authorizationCode,
      state: authChallenge.state,
      nonce: authChallenge.nonce,
      email: credential.email,
      givenName: credential.givenName,
      familyName: credential.familyName,
      language,
    },
  });
}
