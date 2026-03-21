'use background';
import {readSession} from '../account/readSession';
import {getFreshUser} from '../account/user/getUser';
import {getPmUser} from '../account/user/getPmUser';
import {
	connectLogical,
	disconnect,
	getCurrentState,
	getCurrentStateIfDefined,
	logOut,
	waitForReadyState
} from '../state';
import {createSession} from '../account/createSession';
import {
	BackgroundAction,
	BackgroundData,
	BackgroundMessage,
	PermissionGrant,
	SettingChange,
	StateChange
} from './MessageType';
import {sendForkResponse} from '../tools/openTabs';
import {setupHandleProxyRequest} from '../tools/setupHandleProxyRequest';
import {record} from '../log/record';
import {forkSession} from './forkSession';
import {provisionSession} from './provisionSession';

export const routeMessage = async (message: { type: BackgroundMessage, data: any }): Promise<any> => {
	const { type, data } = message;

	switch (type) {
		case BackgroundAction.FORK:
			await sendForkResponse((message as any).tabId, await forkSession(message));

			return null;

		case BackgroundAction.PROVISION_SESSION:
			await provisionSession(message);

			return null;

		case BackgroundData.USER:
			if (!(await readSession())?.uid) {
				throw new Error('No session');
			}

			return await getFreshUser();

		case BackgroundData.PM_USER:
			if (!(await readSession())?.uid) {
				throw new Error('No session');
			}

			return await getPmUser(true);

		case StateChange.SIGN_OUT:
			logOut(true);
			await createSession();
			break;

		case StateChange.SWITCH_ACCOUNT:
			logOut(false);
			await createSession();
			break;

		case BackgroundData.STATE:
			return getCurrentState().data;

		case BackgroundData.VPN_STATUS: {
			await waitForReadyState();
			const state = getCurrentStateIfDefined() || getCurrentState();
			const error = state.data?.error as {message?: string} | undefined;

			return {
				state: state.name,
				connected: state.name === 'on',
				loggedIn: state.name !== 'loggedout',
				starting: !!state.data?.starting,
				proxyEnabled: !!state.proxyEnabled,
				server: state.data?.server,
				error: error?.message ? {message: error.message} : undefined,
			};
		}

		case StateChange.DISCONNECT:
			disconnect();
			break;

		case StateChange.CONNECTING:
			getCurrentState().checkConnectingState?.(data.connectionAttemptTime);
			break;

		case StateChange.CONNECT:
			await connectLogical(data.logical, data.server, data.splitTunneling);
			break;

		case BackgroundAction.FORGET_ERROR:
			delete getCurrentState().data.error;
			break;

		case BackgroundAction.LOG:
			record(data);
			break;

		case PermissionGrant.PROXY:
			setupHandleProxyRequest();
			break;

		case SettingChange.BYPASS_LIST:
			getCurrentState().setOption?.(type, data);
			break;
	}

	return undefined;
};
