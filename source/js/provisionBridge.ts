const BRIDGE_TYPE = 'provisionSession';
const BRIDGE_RESULT_TYPE = 'provisionSessionResult';

type ProvisionSessionPayload = {
	uid: string;
	accessToken: string;
	refreshToken: string;
	persistent: boolean;
	redirectURI?: string;
	partnerId?: string;
	setup?: Record<string, unknown>;
};

type ProvisionBridgeMessage = {
	type?: string;
	data?: ProvisionSessionPayload;
};

const isProvisionSessionPayload = (data: unknown): data is ProvisionSessionPayload => {
	if (!data || typeof data !== 'object') {
		return false;
	}

	const payload = data as Record<string, unknown>;

	return typeof payload['uid'] === 'string'
		&& typeof payload['accessToken'] === 'string'
		&& typeof payload['refreshToken'] === 'string'
		&& typeof payload['persistent'] === 'boolean'
		&& (typeof payload['redirectURI'] === 'undefined' || typeof payload['redirectURI'] === 'string')
		&& (typeof payload['partnerId'] === 'undefined' || typeof payload['partnerId'] === 'string')
		&& (typeof payload['setup'] === 'undefined'
			|| (!!payload['setup'] && typeof payload['setup'] === 'object' && !Array.isArray(payload['setup'])));
};

window.addEventListener('message', (event: MessageEvent<ProvisionBridgeMessage>) => {
	if (event.source !== window || event.origin !== window.location.origin) {
		return;
	}

	if (event.data?.type !== BRIDGE_TYPE) {
		return;
	}

	if (!isProvisionSessionPayload(event.data.data)) {
		return;
	}

	chrome.runtime.sendMessage({
		type: 'provisionSession',
		data: event.data.data,
	}, (response) => {
		const lastError = chrome.runtime.lastError;
		window.postMessage({
			type: BRIDGE_RESULT_TYPE,
			data: lastError
				? {
					received: false,
					success: false,
					result: {
						error: {
							message: lastError.message || 'Unknown runtime messaging error',
						},
					},
				}
				: response,
		}, window.location.origin);
	});
}, false);
