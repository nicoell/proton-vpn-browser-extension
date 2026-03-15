import {Session} from '../account/Session';
import {saveSession} from '../account/saveSession';
import {getFreshUser} from '../account/user/getUser';
import {triggerPromise} from '../tools/triggerPromise';

export interface ProvisionSessionMessage {
	data?: {
		uid?: string;
		accessToken?: string;
		refreshToken?: string;
		persistent?: boolean;
		redirectURI?: string;
		partnerId?: string;
	};
}

export const provisionSession = async (message: ProvisionSessionMessage): Promise<void> => {
	const {
		uid,
		accessToken,
		refreshToken,
		persistent,
		redirectURI,
		partnerId,
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

	triggerPromise(getFreshUser());
};
