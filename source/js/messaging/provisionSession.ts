import {applyProvisioningSetup, type ProvisioningSetup} from './applyProvisioningSetup';
import {Session} from '../account/Session';
import {readSession} from '../account/readSession';
import {saveSession} from '../account/saveSession';
import {getFreshUser} from '../account/user/getUser';

const PROVISION_SESSION_SAVE_ATTEMPTS = 5;
const PROVISION_SESSION_SAVE_DELAY_MS = 50;

const delay = async (ms: number): Promise<void> => {
	await new Promise(resolve => setTimeout(resolve, ms));
};

const hasProvisionedSession = (session?: Session | null): session is Session => Boolean(session?.uid && session?.refreshToken);

const saveAndVerifyProvisionedSession = async (session: Session): Promise<Session> => {
	for (let attempt = 0; attempt < PROVISION_SESSION_SAVE_ATTEMPTS; attempt++) {
		await saveSession(session);
		await delay(PROVISION_SESSION_SAVE_DELAY_MS);

		const savedSession = await readSession();
		if (hasProvisionedSession(savedSession)) {
			return savedSession;
		}
	}

	throw new Error(`Provision session could not be observed after ${PROVISION_SESSION_SAVE_ATTEMPTS} save attempts`);
};

export interface ProvisionSessionMessage {
	data?: {
		uid?: string;
		accessToken?: string;
		refreshToken?: string;
		persistent?: boolean;
		redirectURI?: string;
		partnerId?: string;
		setup?: ProvisioningSetup;
	};
}

export const provisionSession = async (message: ProvisionSessionMessage): Promise<{
	sessionProvisioned: boolean;
	connectRequested: boolean;
	connectNow: boolean;
	connected: boolean;
	finalState?: string;
}> => {
	const {
		uid,
		accessToken,
		refreshToken,
		persistent,
		redirectURI,
		partnerId,
		setup,
	} = message?.data || {};

	if (!uid || !accessToken || !refreshToken) {
		throw new Error('Invalid session payload');
	}

	const session: Session = {
		uid,
		accessToken,
		refreshToken,
		persistent,
		redirectURI,
		partnerId,
	};

	await saveAndVerifyProvisionedSession(session);
	const user = await getFreshUser();
	if (user) {
		const result = await applyProvisioningSetup(setup, user);
		if (result.connect.requested && result.connect.connectNow && !result.connect.connected) {
			const error = new Error(
				result.connect.error?.message || 'Proton VPN provisioning connect did not reach the connected state.'
			);
			(error as Error & {provisioningResult?: unknown}).provisioningResult = result;
			throw error;
		}

		return {
			sessionProvisioned: true,
			connectRequested: result.connect.requested,
			connectNow: result.connect.connectNow,
			connected: result.connect.connected,
			finalState: result.connect.finalState,
		};
	}

	return {
		sessionProvisioned: true,
		connectRequested: false,
		connectNow: false,
		connected: false,
	};
};
