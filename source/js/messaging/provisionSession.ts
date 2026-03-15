import {applyProvisioningSetup, type ProvisioningSetup} from './applyProvisioningSetup';
import {Session} from '../account/Session';
import {saveSession} from '../account/saveSession';
import {getFreshUser} from '../account/user/getUser';

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

	await saveSession(session);
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
