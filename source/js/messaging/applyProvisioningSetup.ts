import {getUserMaxTier} from '../account/user/getUserMaxTier';
import type {User} from '../account/user/User';
import {storedNotificationsEnabled} from '../notifications/notificationsEnabled';
import {connectLogical, getCurrentStateIfDefined, isCurrentStateConnected, waitForReadyState} from '../state';
import {delay} from '../tools/delay';
import {hasProxy} from '../tools/proxy';
import {getLogicalById, getSortedLogicals} from '../vpn/getLogicals';
import {requireBestLogical, requireRandomLogical} from '../vpn/getLogical';
import {getLogicalsFilteredByChoice, setLastChoice, type Choice} from '../vpn/lastChoice';
import {pickServerInLogical} from '../vpn/pickServerInLogical';
import {storedAutoConnect} from '../vpn/storedAutoConnect';
import {getSecureCorePredicate} from '../vpn/getSecureCorePredicate';
import {storedSecureCore} from '../vpn/storedSecureCore';
import {getSplitTunnelingConfig} from '../vpn/getSplitTunnelingConfig';
import {storedSplitTunneling} from '../vpn/storedSplitTunneling';
import type {StoredWebsiteFilterList, WebsiteFilter} from '../vpn/WebsiteFilter';
import {preventLeak} from '../webrtc/preventLeak';
import {storedPreventWebrtcLeak} from '../webrtc/storedPreventWebrtcLeak';

type ProvisioningSettingFlags = {
	notificationsEnabled?: boolean;
	preventWebrtcLeak?: boolean;
	autoConnect?: boolean;
	secureCore?: boolean;
};

type ProvisioningSplitTunneling = {
	enabled?: boolean;
	mode?: StoredWebsiteFilterList['mode'];
	domains?: Array<string | (Partial<WebsiteFilter> & {domain: string})>;
};

type ProvisioningConnect = {
	connectNow?: boolean;
	choice?: Partial<Choice>;
	serverId?: string | number;
	serverLabel?: string;
};

export interface ProvisioningSetup {
	settings?: ProvisioningSettingFlags & {
		splitTunneling?: ProvisioningSplitTunneling;
	};
	connect?: boolean | ProvisioningConnect;
}

export interface ProvisioningSetupResult {
	settingsApplied: boolean;
	connect: {
		requested: boolean;
		connectNow: boolean;
		connected: boolean;
		logicalId?: string | number;
		logicalName?: string;
		serverId?: string | number;
		serverLabel?: string | null;
		serverDomain?: string;
		finalState?: string;
		error?: {
			message: string;
			stack?: string;
		};
	};
}

const normalizeWebsiteFilter = (value: string | (Partial<WebsiteFilter> & {domain: string})): WebsiteFilter => {
	if (typeof value === 'string') {
		return {
			domain: value,
			withSubDomains: true,
		};
	}

	return {
		domain: value.domain,
		withSubDomains: value.withSubDomains !== false,
		...(value.mode ? {mode: value.mode} : {}),
	};
};

const applyBooleanSetting = async (
	value: boolean | undefined,
	store: { setValue(value: boolean): Promise<void> },
): Promise<void> => {
	if (typeof value !== 'boolean') {
		return;
	}

	await store.setValue(value);
};

const asErrorDump = (error: unknown): {message: string, stack?: string} => {
	if (error instanceof Error) {
		return {
			message: error.message,
			stack: error.stack,
		};
	}

	if (error && typeof error === 'object' && 'message' in error) {
		const message = String((error as {message: unknown}).message || 'Unknown error');
		const stack = 'stack' in error ? String((error as {stack?: unknown}).stack || '') : undefined;

		return {
			message,
			...(stack ? {stack} : {}),
		};
	}

	return {
		message: String(error || 'Unknown error'),
	};
};

const normalizeChoice = (choice: Partial<Choice> | undefined): Choice => ({
	connected: true,
	...(choice || {}),
});

const selectLogicalForChoice = (
	userTier: number,
	logicals: Awaited<ReturnType<typeof getSortedLogicals>>,
	choice: Choice,
	secureCore: {value: boolean},
) => {
	const filteredList = getLogicalsFilteredByChoice(
		logicals
			.filter(getSecureCorePredicate(userTier, secureCore))
			.filter(logical => userTier >= logical.Tier),
		choice,
		id => {
			const logical = getLogicalById(id);

			return logical ? [logical] : [];
		},
	);

	if (!filteredList.length) {
		return undefined;
	}

	if (choice.pick === 'random') {
		return requireRandomLogical(filteredList, userTier);
	}

	return requireBestLogical(filteredList, userTier);
};

const resolveProvisioningConnect = async (
	connect: boolean | ProvisioningConnect | undefined,
	user: User,
): Promise<{ logical: NonNullable<ReturnType<typeof selectLogicalForChoice>>, choice: Choice, connectNow: boolean, serverId?: string | number, serverLabel?: string } | undefined> => {
	if (!connect) {
		return undefined;
	}

	const connectConfig = connect === true
		? { connectNow: true, choice: { connected: true, pick: 'fastest' as const } }
		: connect;
	const choice = normalizeChoice(connectConfig.choice);
	const userTier = getUserMaxTier(user);
	const logicals = await getSortedLogicals();
	const secureCore = await storedSecureCore.getDefined({value: false});
	const logical = selectLogicalForChoice(userTier, logicals, choice, secureCore);

	if (!logical) {
		return undefined;
	}

	return {
		logical,
		choice,
		connectNow: connectConfig.connectNow !== false,
		serverId: connectConfig.serverId,
		serverLabel: connectConfig.serverLabel,
	};
};

const pickProvisionedServer = (
	logical: NonNullable<ReturnType<typeof selectLogicalForChoice>>,
	config: {serverId?: string | number, serverLabel?: string},
) => (logical.Servers || []).find(server => (
		(typeof config.serverId !== 'undefined' && server.ID === config.serverId)
		|| (typeof config.serverLabel === 'string' && server.Label === config.serverLabel)
	))
	|| pickServerInLogical(logical);

const waitForProvisionedConnection = async (
	timeoutMs = 15000,
): Promise<{connected: boolean, finalState?: string, error?: {message: string, stack?: string}}> => {
	const startedAt = Date.now();

	while ((Date.now() - startedAt) < timeoutMs) {
		const state = getCurrentStateIfDefined();
		const finalState = state?.name;

		if (state?.data?.error) {
			return {
				connected: false,
				finalState,
				error: asErrorDump(state.data.error),
			};
		}

		if (isCurrentStateConnected()) {
			try {
				if (await hasProxy()) {
					return {
						connected: true,
						finalState,
					};
				}
			} catch (error) {
				return {
					connected: false,
					finalState,
					error: asErrorDump(error),
				};
			}
		}

		await delay(250);
	}

	const timeoutState = getCurrentStateIfDefined();
	return {
		connected: false,
		finalState: timeoutState?.name,
		error: {
			message: 'Timed out waiting for Proton VPN connection to become active.',
		},
	};
};

export const applyProvisioningSetup = async (
	setup: ProvisioningSetup | undefined,
	user: User,
): Promise<ProvisioningSetupResult> => {
	const result: ProvisioningSetupResult = {
		settingsApplied: false,
		connect: {
			requested: false,
			connectNow: false,
			connected: false,
		},
	};

	if (!setup || typeof setup !== 'object' || Array.isArray(setup)) {
		return result;
	}

	const settings = setup.settings;

	if (settings) {
		await Promise.all([
			applyBooleanSetting(settings.notificationsEnabled, storedNotificationsEnabled),
			applyBooleanSetting(settings.autoConnect, storedAutoConnect),
			applyBooleanSetting(settings.secureCore, storedSecureCore),
			applyBooleanSetting(settings.preventWebrtcLeak, storedPreventWebrtcLeak),
		]);

		if (typeof settings.preventWebrtcLeak === 'boolean') {
			await preventLeak(settings.preventWebrtcLeak);
		}

		if (settings.splitTunneling && typeof settings.splitTunneling === 'object' && !Array.isArray(settings.splitTunneling)) {
			const splitTunneling = settings.splitTunneling;
			const domains = Array.isArray(splitTunneling.domains)
				? splitTunneling.domains.map(normalizeWebsiteFilter)
				: [];
			await storedSplitTunneling.setValue(domains, {
				...(typeof splitTunneling.enabled === 'boolean' ? {enabled: splitTunneling.enabled} : {}),
				...(splitTunneling.mode ? {mode: splitTunneling.mode} : {}),
			});
		}

		result.settingsApplied = true;
	}

	const connectConfig = await resolveProvisioningConnect(setup.connect, user);
	if (!connectConfig) {
		return result;
	}

	result.connect.requested = true;
	result.connect.connectNow = connectConfig.connectNow;
	result.connect.logicalId = connectConfig.logical.ID;
	result.connect.logicalName = connectConfig.logical.Name;

	setLastChoice(connectConfig.choice);
	if (!connectConfig.connectNow) {
		return result;
	}

	const server = pickProvisionedServer(connectConfig.logical, connectConfig);
	if (!server?.Domain) {
		result.connect.error = {
			message: 'Unable to select a Proton VPN server for provisioning connect.',
		};
		return result;
	}
	result.connect.serverId = server.ID;
	result.connect.serverLabel = server.Label || null;
	result.connect.serverDomain = server.Domain;

	const splitTunneling = await storedSplitTunneling.getDefined({value: []});
	await waitForReadyState();
	try {
		await connectLogical(
			connectConfig.logical,
			server,
			getSplitTunnelingConfig(getUserMaxTier(user), splitTunneling),
		);
	} catch (error) {
		result.connect.error = asErrorDump(error);
		result.connect.finalState = getCurrentStateIfDefined()?.name;
		return result;
	}

	const outcome = await waitForProvisionedConnection();
	result.connect.connected = outcome.connected;
	result.connect.finalState = outcome.finalState;
	if (outcome.error) {
		result.connect.error = outcome.error;
	}

	return result;
};
