// src/lib/cognito.ts
// AWS Cognito client wrapper for direct authentication (no OAuth redirect)

import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
} from 'amazon-cognito-identity-js';

// ============================================================================
// LAZY INITIALIZATION
// ============================================================================
let userPool: CognitoUserPool | null = null;

function getUserPool(): CognitoUserPool {
  if (userPool) return userPool;

  const poolData = {
    UserPoolId: process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || process.env.COGNITO_USER_POOL_ID || '',
    ClientId: process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID || process.env.COGNITO_CLIENT_ID || '',
  };

  if (!poolData.UserPoolId || !poolData.ClientId) {
    throw new Error('Cognito configuration missing. Set COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID');
  }

  userPool = new CognitoUserPool(poolData);
  return userPool;
}

// ============================================================================
// TYPES
// ============================================================================
export interface SignInParams {
  email: string;
  password: string;
  mfaCode?: string;
  mfaType?: 'TOTP' | 'SMS';
}

export interface CognitoTokens {
  accessToken: string;
  idToken: string;
  refreshToken: string;
}

export interface AuthResult {
  success: boolean;
  message?: string;
  error?: string;
  tokens?: CognitoTokens;
  user?: {
    email: string;
    firstName: string;
    lastName: string;
    name: string;
    accountType: string;
    sub: string;
  };
  needsVerification?: boolean;
  needsMfa?: boolean;
  mfaType?: 'TOTP' | 'SMS';
}

// Store for MFA challenge
let pendingMfaUser: CognitoUser | null = null;
let pendingMfaSession: any = null;

// ============================================================================
// SIGN IN
// ============================================================================
export async function signIn(params: SignInParams): Promise<AuthResult> {
  const { email, password, mfaCode, mfaType } = params;

  return new Promise((resolve) => {
    try {
      const pool = getUserPool();

      // If MFA code is provided, complete the MFA challenge
      if (mfaCode && pendingMfaUser && pendingMfaSession) {
        console.log('🔐 Completing MFA challenge...');

        if (mfaType === 'TOTP') {
          pendingMfaUser.sendMFACode(mfaCode, {
            onSuccess: (session) => {
              console.log('✅ TOTP MFA verification successful');
              handleSuccessfulAuth(session, email, resolve);
              pendingMfaUser = null;
              pendingMfaSession = null;
            },
            onFailure: (err) => {
              console.error('❌ TOTP MFA verification failed:', err);
              resolve({
                success: false,
                error: err.message || 'Invalid verification code',
              });
            },
          }, 'SOFTWARE_TOKEN_MFA');
        } else {
          pendingMfaUser.sendMFACode(mfaCode, {
            onSuccess: (session) => {
              console.log('✅ SMS MFA verification successful');
              handleSuccessfulAuth(session, email, resolve);
              pendingMfaUser = null;
              pendingMfaSession = null;
            },
            onFailure: (err) => {
              console.error('❌ SMS MFA verification failed:', err);
              resolve({
                success: false,
                error: err.message || 'Invalid verification code',
              });
            },
          });
        }
        return;
      }

      // Initial authentication
      const cognitoUser = new CognitoUser({
        Username: email,
        Pool: pool,
      });

      const authDetails = new AuthenticationDetails({
        Username: email,
        Password: password,
      });

      cognitoUser.authenticateUser(authDetails, {
        onSuccess: (session) => {
          console.log('✅ Sign in successful');
          handleSuccessfulAuth(session, email, resolve);
        },

        onFailure: (err) => {
          console.error('Cognito signIn error:', err);

          if (err.code === 'UserNotConfirmedException') {
            resolve({
              success: false,
              error: 'Please verify your email before signing in.',
              needsVerification: true,
            });
            return;
          }

          resolve({
            success: false,
            error: err.message || 'Failed to sign in',
          });
        },

        newPasswordRequired: () => {
          resolve({
            success: false,
            error: 'Password change required. Please contact support.',
          });
        },

        totpRequired: (challengeName, challengeParameters) => {
          console.log('🔐 TOTP MFA required');
          pendingMfaUser = cognitoUser;
          pendingMfaSession = challengeParameters;

          resolve({
            success: false,
            needsMfa: true,
            mfaType: 'TOTP',
            message: 'Please enter the code from your authenticator app',
            error: 'MFA_REQUIRED',
          });
        },

        mfaRequired: (challengeName, challengeParameters) => {
          console.log('🔐 SMS MFA required');
          pendingMfaUser = cognitoUser;
          pendingMfaSession = challengeParameters;

          resolve({
            success: false,
            needsMfa: true,
            mfaType: 'SMS',
            message: 'Please enter the code sent to your phone',
            error: 'MFA_REQUIRED',
          });
        },

        selectMFAType: (challengeName, challengeParameters) => {
          console.log('🔐 Select MFA type required');
          cognitoUser.sendMFASelectionAnswer('SOFTWARE_TOKEN_MFA', {
            onSuccess: (session) => {
              handleSuccessfulAuth(session, email, resolve);
            },
            onFailure: (err) => {
              resolve({
                success: false,
                error: err.message || 'MFA selection failed',
              });
            },
            totpRequired: (challengeName, challengeParameters) => {
              pendingMfaUser = cognitoUser;
              pendingMfaSession = challengeParameters;
              resolve({
                success: false,
                needsMfa: true,
                mfaType: 'TOTP',
                message: 'Please enter the code from your authenticator app',
                error: 'MFA_REQUIRED',
              });
            },
            mfaRequired: (challengeName, challengeParameters) => {
              pendingMfaUser = cognitoUser;
              pendingMfaSession = challengeParameters;
              resolve({
                success: false,
                needsMfa: true,
                mfaType: 'SMS',
                message: 'Please enter the code sent to your phone',
                error: 'MFA_REQUIRED',
              });
            },
          });
        },
      });
    } catch (err: any) {
      resolve({
        success: false,
        error: err.message || 'Failed to initialize Cognito',
      });
    }
  });
}

// Helper function to handle successful authentication
function handleSuccessfulAuth(session: any, email: string, resolve: (value: AuthResult) => void) {
  const idToken = session.getIdToken();
  const accessToken = session.getAccessToken();
  const refreshToken = session.getRefreshToken();

  const payload = idToken.decodePayload();

  const firstName = payload.given_name || '';
  const lastName = payload.family_name || '';
  const fullName = payload.name || `${firstName} ${lastName}`.trim() || email.split('@')[0];

  resolve({
    success: true,
    message: 'Sign in successful',
    tokens: {
      accessToken: accessToken.getJwtToken(),
      idToken: idToken.getJwtToken(),
      refreshToken: refreshToken.getToken(),
    },
    user: {
      email: payload.email || email,
      firstName: firstName,
      lastName: lastName,
      name: fullName,
      accountType: payload['custom:account_type'] || 'personal',
      sub: payload.sub || '',
    },
  });
}

// ============================================================================
// CLEAR PENDING MFA
// ============================================================================
export function clearPendingMfa(): void {
  pendingMfaUser = null;
  pendingMfaSession = null;
}

// ============================================================================
// SIGN OUT
// ============================================================================
export function signOut(): void {
  try {
    const pool = getUserPool();
    const cognitoUser = pool.getCurrentUser();
    if (cognitoUser) {
      cognitoUser.signOut();
    }
    clearPendingMfa();
  } catch (err) {
    console.error('Sign out error:', err);
  }
}
