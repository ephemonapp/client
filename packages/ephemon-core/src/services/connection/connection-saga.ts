import { IceSource } from '../../models/ice-source';
import { Base64 } from '../../utils/base64';
import { Cryptography, CryptoKeyPair } from '../../utils/cryptography';
import { Logger } from '../../utils/logger';
import { newError } from '../../utils/new-error';
import { Utf8 } from '../../utils/utf8';
import { CallService } from '../call-service';
import { SessionService } from '../session-service';
import { TimeService } from '../time-service';
import { classifyCallError, ConnectionError } from './connection-error';
import { IceServer } from './ice-server';
import { WebRTC } from './web-rtc';

export enum ConnectionSagaState {
    New = 0,
    AwaitDial,
    AwaitingDial,
    DialAccepted,
    SendDial,
    SendingDial,
    DialSent,
    AwaitOffer,
    AwaitingOffer,
    OfferReceived,
    SendOffer,
    SendingOffer,
    OfferSent,
    AwaitAnswer,
    AwaitingAnswer,
    AnswerReceived,
    SendAnswer,
    SendingAnswer,
    AnswerSent,
    AwaitConnection,
    AwaitingConnection,
    Connected,
    Closed,
}

export type ConnectionSagaType = 'incoming' | 'outgoing';

export type ConnectionSagaTransport = 'direct' | 'relay';

export interface ConnectionSaga {
    onStateChanged?: (from: ConnectionSagaState, to: ConnectionSagaState) => void;
    onMessage?: (message: Uint8Array) => void;
    onTransportChanged?: (transport: ConnectionSagaTransport) => void;
    onPeerServerUrl?: (serverUrl: string) => void;
    onFailed?: (error: ConnectionError) => void;

    get publicKey(): string;

    get state(): ConnectionSagaState;

    /** The transport of the established connection (direct P2P or relay), or undefined until the connection is established and the selected candidate is known. */
    get transport(): ConnectionSagaTransport | undefined;

    get type(): ConnectionSagaType;

    get continue(): () => void;

    get abort(): () => void;

    open(initialState: ConnectionSagaState): Promise<ConnectionSaga>;

    setEncryption(encryptionPublicKeyBase64: string): void;

    setDescription(encryptedDataBase64: string): Promise<void>;

    addIceCandidate(encryptedDataBase64: string): Promise<void>;

    send(message: Uint8Array): void;
}

interface WebRtcDescription {
    sdp?: string;
    // noinspection SpellCheckingInspection
    type: 'answer' | 'offer' | 'pranswer' | 'rollback';
}

/** Besides the session description it carries the address of the server the sender is registered on, which is how a peer learns where to reach back when the two sides do not share a prime server. */
interface WebRtcDescriptionEnvelope {
    serverUrl?: string;

    description: WebRtcDescription;
}

interface WebRtcIceCandidate {
    candidate?: string;
    sdpMLineIndex?: number | null;
    sdpMid?: string | null;
    usernameFragment?: string | null;
}

export function getConnectionSaga(
    publicKey: string,
    type: ConnectionSagaType,
    logger: Logger,
    timeService: TimeService,
    getCallService: () => CallService,
    getOwnServerUrl: () => string | undefined,
    sessionService: SessionService,
    base64: Base64,
    utf8: Utf8,
    cryptography: Cryptography,
    webRTC: WebRTC,
    iceServers?: IceServer[],
    maxStepWaitMilliseconds: number = 60 * 1000,
    maxDisconnectWaitMilliseconds: number = 10 * 1000,
): ConnectionSaga {
    let createdAt = timeService.serverTime;
    let encryptionKeyPair: CryptoKeyPair = cryptography.generateEncryptionKeyPair();
    let state: ConnectionSagaState = ConnectionSagaState.New;
    let transport: ConnectionSagaTransport | undefined;
    const stateAwaiterGteMap: {
        [state: number]: (() => void)[];
    } = {};

    function setState(value: ConnectionSagaState) {
        const current = state;
        state = value;
        new Promise<void>((resolve) => {
            if (saga.onStateChanged) {
                saga.onStateChanged(current, state);
            }
            resolve();
        }).catch((err) => {
            logger.error(`[connection-saga] State change callback error in ${type} connection with ${publicKey}.`, err);
        });
        for (let i = value; i >= 0; --i) {
            if (stateAwaiterGteMap[i]) {
                for (const callback of stateAwaiterGteMap[i]) {
                    callback();
                }
                stateAwaiterGteMap[i] = [];
            }
        }
    }

    let _continueCallback: (() => void) | undefined;
    let iceCandidates: WebRtcIceCandidate[] = [];
    let _rtcPeerConnection: RTCPeerConnection | undefined;

    function getRtcPeerConnection(): RTCPeerConnection {
        if (!_rtcPeerConnection) {
            throw newError(
                logger,
                `[connection-saga] WebRTC peer connection is not initialized in ${type} connection with ${publicKey}.`,
            );
        }
        return _rtcPeerConnection;
    }

    let _rtcSendDataChannel: RTCDataChannel | undefined;
    let rtcReceiveDataChannel: RTCDataChannel | undefined;

    function getRtcSendDataChannel(): RTCDataChannel {
        if (!_rtcSendDataChannel) {
            throw newError(
                logger,
                `[connection-saga] WebRTC data send channel is not initialized in ${type} connection with ${publicKey}.`,
            );
        }
        return _rtcSendDataChannel;
    }

    let _sharedSymmetricKey: Uint8Array | undefined;

    function getSharedSymmetricKey(): Uint8Array {
        if (!_sharedSymmetricKey) {
            throw newError(
                logger,
                `[connection-saga] Shared symmetric key is not initialized in ${type} connection with ${publicKey}.`,
            );
        }
        return _sharedSymmetricKey;
    }

    function setSharedSymmetricKey(value: Uint8Array) {
        _sharedSymmetricKey = value;
    }

    async function awaitStateGte(value: ConnectionSagaState): Promise<void> {
        if (state >= value) {
            return;
        }
        await new Promise<void>((resolve) => {
            logger.debug(
                `[connection-saga] Awaiting for saga state = ${ConnectionSagaState[value]} in ${type} connection with ${publicKey}. Current state = ${ConnectionSagaState[state]}`,
            );
            stateAwaiterGteMap[value] = stateAwaiterGteMap[value] || [];
            stateAwaiterGteMap[value].push(resolve);
        });
        logger.debug(
            `[connection-saga] Got saga state = ${ConnectionSagaState[state]} in ${type} connection with ${publicKey}.`,
        );
    }

    function setContinueCallback(value: () => void, reason?: string): void {
        _continueCallback = value;
        logger.debug(`[connection-saga] Continue callback set.`, reason);
    }

    function removeContinueCallback(reason?: string): void {
        _continueCallback = undefined;
        logger.debug(`[connection-saga] Continue callback removed.`, reason);
    }

    let rtcSendDataChannelSafeKiller: (() => void) | undefined;
    let rtcReceiveDataChannelSafeKiller: (() => void) | undefined;
    let stepTimeout: NodeJS.Timeout | undefined;
    let disconnectTimeout: NodeJS.Timeout | undefined;

    function clearDisconnectTimeout(): void {
        clearTimeout(disconnectTimeout);
        disconnectTimeout = undefined;
    }

    function reportTransportLost(reason: string): void {
        clearDisconnectTimeout();
        if (state !== ConnectionSagaState.Connected) {
            logger.debug(
                `[connection-saga] Transport loss (${reason}) ignored in ${type} connection with ${publicKey} on state='${ConnectionSagaState[state]}'.`,
            );
            return;
        }
        logger.debug(`[connection-saga] Transport lost (${reason}) in ${type} connection with ${publicKey}.`);
        saga.abort();
    }

    function scheduleTransportLost(reason: string): void {
        if (disconnectTimeout !== undefined) {
            return;
        }
        logger.debug(
            `[connection-saga] Awaiting up to ${maxDisconnectWaitMilliseconds}ms for ${reason} to recover in ${type} connection with ${publicKey}.`,
        );
        disconnectTimeout = setTimeout(
            () => reportTransportLost(`${reason} for more than ${maxDisconnectWaitMilliseconds}ms`),
            maxDisconnectWaitMilliseconds,
        );
    }

    function onRtcStateChanged(peerConnection: RTCPeerConnection, source: 'connectionState' | 'iceConnectionState') {
        return () => {
            const value: RTCPeerConnectionState | RTCIceConnectionState =
                source === 'connectionState' ? peerConnection.connectionState : peerConnection.iceConnectionState;
            logger.debug(`[connection-saga] WebRTC ${source}='${value}' in ${type} connection with ${publicKey}.`);
            if (value === 'failed' || value === 'closed') {
                reportTransportLost(`${source}='${value}'`);
            } else if (value === 'disconnected') {
                scheduleTransportLost(`${source}='${value}'`);
            } else if (value === 'connected' || value === 'completed') {
                clearDisconnectTimeout();
            }
        };
    }

    async function awaitDial(): Promise<boolean> {
        logger.debug(`[connection-saga] Awaiting for Dial in ${type} connection with ${publicKey}`);
        return await new Promise<void>(async (resolve, reject) => {
            stepTimeout = setTimeout(reject, maxStepWaitMilliseconds);
            setContinueCallback(resolve, 'Awaiting for Dial.');
            setState(ConnectionSagaState.AwaitingDial);
        }).then(
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Dial Accepted.');
                logger.debug(`[connection-saga] Dial received in ${type} connection with ${publicKey}.`);
                setState(ConnectionSagaState.DialAccepted);
                return true;
            },
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Timeout awaiting for Dial.');
                setState(ConnectionSagaState.New);
                return false;
            },
        );
    }

    async function sendDial(): Promise<void> {
        logger.debug(`[connection-saga] Sending Dial in ${type} connection with ${publicKey}`);
        setState(ConnectionSagaState.SendingDial);
        await getCallService().dial(
            sessionService.signingPublicKeyBase64,
            publicKey,
            base64.encode(encryptionKeyPair.publicKey),
        );
        setState(ConnectionSagaState.DialSent);
        logger.debug(`[connection-saga] Dial sent in ${type} connection with ${publicKey}`);
    }

    async function awaitOffer(): Promise<boolean> {
        logger.debug(`[connection-saga] Awaiting for Offer in ${type} connection with ${publicKey}`);
        return await new Promise<void>(async (resolve, reject) => {
            stepTimeout = setTimeout(reject, maxStepWaitMilliseconds);
            setContinueCallback(resolve, 'Awaiting for Offer');
            setState(ConnectionSagaState.AwaitingOffer);
        }).then(
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Offer Received');
                logger.debug(`[connection-saga] Offer received in ${type} connection with ${publicKey}`);
                setState(ConnectionSagaState.OfferReceived);
                return true;
            },
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Timeout awaiting for Offer.');
                setState(ConnectionSagaState.New);
                return false;
            },
        );
    }

    function wrapDescription(description: WebRtcDescription): WebRtcDescriptionEnvelope {
        return {
            serverUrl: getOwnServerUrl(),
            description: description,
        };
    }

    async function gatherWebRtcOffer(): Promise<WebRtcDescription> {
        logger.debug(`[connection-saga] Gathering WebRTC offer data in ${type} connection with ${publicKey}`);
        const offer = await getRtcPeerConnection().createOffer();
        await getRtcPeerConnection().setLocalDescription(offer);
        return offer;
    }

    async function sendOffer(): Promise<void> {
        logger.debug(`[connection-saga] Sending Offer in ${type} connection with ${publicKey}`);
        setState(ConnectionSagaState.SendingOffer);
        const offerData = await gatherWebRtcOffer();
        const offerDataString = JSON.stringify(wrapDescription(offerData));
        const offerDataBytes = utf8.decode(offerDataString);
        const offerDataEncrypted = cryptography.encrypt(offerDataBytes, getSharedSymmetricKey());
        await getCallService().offer(
            sessionService.signingPublicKeyBase64,
            publicKey,
            base64.encode(encryptionKeyPair.publicKey),
            offerDataEncrypted,
        );
        setState(ConnectionSagaState.OfferSent);
        logger.debug(`[connection-saga] Offer sent in ${type} connection with ${publicKey}`);
    }

    async function awaitAnswer(): Promise<boolean> {
        logger.debug(`[connection-saga] Awaiting for Answer in ${type} connection with ${publicKey}`);
        return await new Promise<void>(async (resolve, reject) => {
            stepTimeout = setTimeout(reject, maxStepWaitMilliseconds);
            setContinueCallback(resolve, 'Awaiting for Answer');
            setState(ConnectionSagaState.AwaitingAnswer);
        }).then(
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Answer Received');
                logger.debug(`[connection-saga] Answer received in ${type} connection with ${publicKey}`);
                setState(ConnectionSagaState.AnswerReceived);
                return true;
            },
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Timeout awaiting for Answer.');
                setState(ConnectionSagaState.New);
                return false;
            },
        );
    }

    async function gatherWebRtcAnswer(): Promise<WebRtcDescription> {
        logger.debug(`[connection-saga] Gathering WebRTC answer data in ${type} connection with ${publicKey}`);
        const answer = await getRtcPeerConnection().createAnswer();
        await getRtcPeerConnection().setLocalDescription(answer);
        return answer;
    }

    async function sendAnswer(): Promise<void> {
        logger.debug(`[connection-saga] Sending Answer step in ${type} connection with ${publicKey}`);
        setState(ConnectionSagaState.SendingAnswer);
        const answerData = await gatherWebRtcAnswer();
        const answerDataString = JSON.stringify(wrapDescription(answerData));
        const answerDataBytes = utf8.decode(answerDataString);
        const answerDataEncrypted = cryptography.encrypt(answerDataBytes, getSharedSymmetricKey());
        await getCallService().answer(
            sessionService.signingPublicKeyBase64,
            publicKey,
            base64.encode(encryptionKeyPair.publicKey),
            answerDataEncrypted,
        );
        setState(ConnectionSagaState.AnswerSent);
        logger.debug(`[connection-saga] Answer sent in ${type} connection with ${publicKey}`);
    }

    async function awaitConnection(): Promise<boolean> {
        logger.debug(`[connection-saga] Awaiting for Connection in ${type} connection with ${publicKey}`);
        return await new Promise<void>(async (resolve, reject) => {
            stepTimeout = setTimeout(reject, maxStepWaitMilliseconds);
            setContinueCallback(resolve, 'Awaiting for Connection');
            setState(ConnectionSagaState.AwaitingConnection);
        }).then(
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Connection Established');
                logger.debug(`[connection-saga] Connected in ${type} connection with ${publicKey}`);
                return true;
            },
            () => {
                clearTimeout(stepTimeout);
                removeContinueCallback('Timeout awaiting for Connection.');
                setState(ConnectionSagaState.New);
                return false;
            },
        );
    }

    async function sendIce(candidate: WebRtcIceCandidate): Promise<void> {
        const source = {
            incoming: IceSource.Incoming,
            outgoing: IceSource.Outgoing,
        }[type];
        const candidateString = JSON.stringify(candidate);
        const candidateBytes = utf8.decode(candidateString);
        const encryptedData = cryptography.encrypt(candidateBytes, getSharedSymmetricKey());
        await getCallService().ice(
            sessionService.signingPublicKeyBase64,
            publicKey,
            base64.encode(encryptionKeyPair.publicKey),
            encryptedData,
            source,
        );
    }

    function initializePeerConnection(): void {
        getRtcPeerConnection().onicecandidate = async (event) => {
            if (event.candidate) {
                const candidate = event.candidate.toJSON();
                await sendIce({
                    candidate: candidate.candidate,
                    sdpMLineIndex: candidate.sdpMLineIndex,
                    sdpMid: candidate.sdpMid,
                    usernameFragment: candidate.usernameFragment,
                });
                logger.debug(`[connection-saga] ICE candidate found in ${type} connection with ${publicKey}`);
            } else {
                logger.debug(
                    `[connection-saga] ICE candidate collection completed in ${type} connection with ${publicKey}.`,
                );
            }
        };
        getRtcPeerConnection().ondatachannel = (event) => {
            const dataChannel = event.channel;
            rtcReceiveDataChannelSafeKiller = initializeDataChanel(dataChannel, 'receive');
            rtcReceiveDataChannel = dataChannel;
        };
        const peerConnection = getRtcPeerConnection();
        peerConnection.onconnectionstatechange = onRtcStateChanged(peerConnection, 'connectionState');
        peerConnection.oniceconnectionstatechange = onRtcStateChanged(peerConnection, 'iceConnectionState');
    }

    function initializeDataChanel(dataChannel: RTCDataChannel, suffix: string): () => void {
        logger.debug(`[connection-saga] [${dataChannel.id}] DataChannel-${suffix}(${dataChannel.label}) created`);
        dataChannel.binaryType = 'arraybuffer';
        dataChannel.onopen = async () => {
            if (state === ConnectionSagaState.Closed) {
                dataChannel.close();
                return;
            }
            await awaitStateGte(ConnectionSagaState.AwaitingConnection);
            if (state === ConnectionSagaState.AwaitingConnection) {
                saga.continue();
            } else {
                logger.debug(
                    `[connection-saga] Continue callback skipped. Expected state ${ConnectionSagaState[ConnectionSagaState.AwaitingConnection]}, got ${ConnectionSagaState[state]}`,
                );
            }
            logger.debug(
                `[connection-saga] ${suffix} dataChannel with label '${dataChannel.label}' opened in ${type} connection with ${publicKey}.`,
            );
            logger.debug(
                `[connection-saga] ${suffix} dataChannel with label '${dataChannel.label}' ready state '${dataChannel.readyState}' in ${type} connection with ${publicKey}.`,
            );
        };
        dataChannel.onmessage = (event) => {
            let dataBytes: Uint8Array;
            if (event.data instanceof ArrayBuffer) {
                dataBytes = new Uint8Array(event.data.slice(0));
            } else if (ArrayBuffer.isView(event.data)) {
                const view = event.data;
                dataBytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength).slice();
            } else {
                logger.warn(
                    `[connection-saga] Wrong message type received via ${suffix} dataChannel with label '${dataChannel.label}' in ${type} connection with ${publicKey}.`,
                );
                return;
            }
            const decryptedBytes = cryptography.decrypt(dataBytes, getSharedSymmetricKey());
            const message = decryptedBytes.slice();
            new Promise<void>((resolve) => {
                saga.onMessage?.call(saga, message);
                resolve();
            }).catch((err) => {
                logger.error(`[connection-saga] Message callback error in ${type} connection with ${publicKey}.`, err);
            });
        };
        dataChannel.onclose = () => {
            reportTransportLost(`${suffix} dataChannel with label '${dataChannel.label}' closed`);
        };
        dataChannel.onerror = (event) => {
            logger.debug(
                `[connection-saga] ${suffix} dataChannel with label '${dataChannel.label}' failed in ${type} connection with ${publicKey}.`,
                event,
            );
            reportTransportLost(`${suffix} dataChannel with label '${dataChannel.label}' failed`);
        };
        return () => {
            dataChannel.onopen = null;
            dataChannel.onmessage = null;
            dataChannel.onclose = null;
            dataChannel.onerror = null;
            dataChannel.close();
            logger.debug(
                `[connection-saga] ${suffix} dataChannel with label '${dataChannel.label}' has been safe killed.`,
            );
        };
    }

    function initializeRtc(dataChannelName: string): void {
        clearDisconnectTimeout();
        if (rtcSendDataChannelSafeKiller !== undefined && rtcSendDataChannelSafeKiller !== null) {
            rtcSendDataChannelSafeKiller();
        }
        if (rtcReceiveDataChannelSafeKiller !== undefined && rtcReceiveDataChannelSafeKiller !== null) {
            rtcReceiveDataChannelSafeKiller();
        }
        if (_rtcPeerConnection !== undefined && _rtcPeerConnection !== null) {
            _rtcPeerConnection.onicecandidate = null;
            _rtcPeerConnection.ondatachannel = null;
            _rtcPeerConnection.onconnectionstatechange = null;
            _rtcPeerConnection.oniceconnectionstatechange = null;
            _rtcPeerConnection.close();
        }
        _rtcPeerConnection = new webRTC.PeerConnection({ iceServers: iceServers });
        initializePeerConnection();
        const dataChannel = getRtcPeerConnection().createDataChannel(dataChannelName);
        rtcSendDataChannelSafeKiller = initializeDataChanel(dataChannel, 'send');
        _rtcSendDataChannel = dataChannel;
        iceCandidates = [];
    }

    function fail(error: unknown): void {
        const failure: ConnectionError = classifyCallError(error);
        logger.error(
            `[connection-saga] Signalling failed in ${type} connection with ${publicKey} on state='${ConnectionSagaState[state]}'.`,
            error,
        );
        clearTimeout(stepTimeout);
        removeContinueCallback('Signalling failed.');
        setState(ConnectionSagaState.New);
        new Promise<void>((resolve) => {
            saga.onFailed?.call(saga, failure);
            resolve();
        }).catch((err) => {
            logger.error(`[connection-saga] Failure callback error in ${type} connection with ${publicKey}.`, err);
        });
    }

    async function negotiate(): Promise<void> {
        if (state === ConnectionSagaState.AwaitDial && (await awaitDial())) {
            setState(ConnectionSagaState.SendOffer);
        }

        if (state === ConnectionSagaState.SendDial) {
            await sendDial();
            setState(ConnectionSagaState.AwaitOffer);
        }

        if (state === ConnectionSagaState.AwaitOffer && (await awaitOffer())) {
            setState(ConnectionSagaState.SendAnswer);
        }

        if (state === ConnectionSagaState.SendOffer) {
            await sendOffer();
            setState(ConnectionSagaState.AwaitAnswer);
        }

        if (state === ConnectionSagaState.AwaitAnswer && (await awaitAnswer())) {
            setState(ConnectionSagaState.AwaitConnection);
        }

        if (state === ConnectionSagaState.SendAnswer) {
            await sendAnswer();
            setState(ConnectionSagaState.AwaitConnection);
        }

        if (state === ConnectionSagaState.AwaitConnection && (await awaitConnection())) {
            setState(ConnectionSagaState.Connected);
        }
    }

    async function open(initialState: ConnectionSagaState): Promise<void> {
        clearTimeout(stepTimeout);
        setState(initialState);
        initializeRtc(`${createdAt}:${type}:${publicKey}`);

        try {
            await negotiate();
        } catch (error) {
            fail(error);
            return;
        }

        if (state === ConnectionSagaState.Connected) {
            try {
                let stats = await getRtcPeerConnection().getStats();
                let candidatePair = [...stats.values()].find(
                    (s) => s.type == 'candidate-pair' && (s.selected === undefined || s.selected),
                );
                let candidate = stats.get(candidatePair.localCandidateId);
                const nextTransport: ConnectionSagaTransport = candidate.candidateType == 'relay' ? 'relay' : 'direct';
                if (candidate.candidateType == 'relay') {
                    logger.warn(
                        `[connection-saga] Using relay server ${candidate.address} in ${type} connection with ${publicKey}.`,
                    );
                } else {
                    logger.log(
                        `[connection-saga] Using P2P ${candidate.candidateType} in ${type} connection with ${publicKey}.`,
                    );
                }
                if (nextTransport !== transport) {
                    transport = nextTransport;
                    saga.onTransportChanged?.call(saga, nextTransport);
                }
            } catch (error) {
                logger.warn(
                    `[connection-saga] Unable to resolve the transport in ${type} connection with ${publicKey}.`,
                    error,
                );
            }
        }
    }

    const saga: ConnectionSaga = {
        get publicKey(): string {
            return publicKey;
        },
        get state(): ConnectionSagaState {
            return state;
        },
        get transport(): ConnectionSagaTransport | undefined {
            return transport;
        },
        get type(): ConnectionSagaType {
            return type;
        },
        get continue(): () => void {
            return () => {
                if (!_continueCallback) {
                    throw newError(
                        logger,
                        `[connection-saga] Expected to have continue callback initialized in ${type} connection with ${publicKey} on state='${ConnectionSagaState[state]}'.`,
                    );
                }
                _continueCallback();
            };
        },
        get abort(): () => void {
            return () => {
                clearDisconnectTimeout();
                setState(ConnectionSagaState.Closed);
                if (_rtcSendDataChannel) {
                    try {
                        _rtcSendDataChannel.close();
                        logger.debug(
                            `[connection-saga] Sending DataChannel.close() called in ${type} connection with ${publicKey}.`,
                        );
                    } catch (error) {
                        logger.error(
                            `[connection-saga] Error closing sending DataChannel in ${type} connection.`,
                            error,
                        );
                    }
                }
                if (rtcReceiveDataChannel) {
                    try {
                        rtcReceiveDataChannel.close();
                        logger.debug(
                            `[connection-saga] Receiving DataChannel.close() called in ${type} connection with ${publicKey}.`,
                        );
                    } catch (error) {
                        logger.error(
                            `[connection-saga] Error closing receiving DataChannel in ${type} connection.`,
                            error,
                        );
                    }
                }
                if (_rtcPeerConnection) {
                    try {
                        _rtcPeerConnection.close();
                        logger.debug(
                            `[connection-saga] RTCPeerConnection.close() called in ${type} connection with ${publicKey}.`,
                        );
                    } catch (error) {
                        logger.error(
                            `[connection-saga] Error closing RTC peer connection in ${type} connection.`,
                            error,
                        );
                    }
                }
            };
        },
        onStateChanged: undefined,
        onMessage: undefined,
        async open(initialState: ConnectionSagaState): Promise<ConnectionSaga> {
            await open(initialState);
            return this;
        },
        setEncryption(encryptionPublicKeyBase64: string) {
            logger.debug(`[connection-saga] Received encryption public key in ${type} connection with ${publicKey}`);
            const encryptionPublicKey = base64.decode(encryptionPublicKeyBase64);
            setSharedSymmetricKey(
                cryptography.generateSharedSymmetricKey(encryptionPublicKey, encryptionKeyPair.secretKey),
            );
            logger.debug(
                `[connection-saga] Created encryption shared symmetric key in ${type} connection with ${publicKey}`,
            );
        },
        async setDescription(encryptedDataBase64: string): Promise<void> {
            logger.debug(
                `[connection-saga] Received remote WebRTC description in ${type} connection with ${publicKey}`,
            );
            if (getRtcPeerConnection().remoteDescription) {
                logger.debug(
                    `[connection-saga] Remote WebRTC description ignored in ${type} connection with ${publicKey}. Remote WebRTC description already set.`,
                );
                return;
            }
            const encryptedDataBytes = base64.decode(encryptedDataBase64);
            const remoteDataBytes = cryptography.decrypt(encryptedDataBytes, getSharedSymmetricKey());
            const remoteDataString = utf8.encode(remoteDataBytes);
            const remoteData = JSON.parse(remoteDataString);
            const remoteEnvelope = remoteData as WebRtcDescriptionEnvelope;
            const remoteDescription = remoteEnvelope?.description;
            if (!remoteDescription) {
                throw newError(
                    logger,
                    `[connection-saga] Wrong remote WebRTC description format in ${type} connection with ${publicKey}.`,
                );
            }
            if (remoteEnvelope.serverUrl) {
                saga.onPeerServerUrl?.call(saga, remoteEnvelope.serverUrl);
            }
            await getRtcPeerConnection().setRemoteDescription(remoteDescription);
            for (const iceCandidate of iceCandidates) {
                logger.debug(
                    `[connection-saga] Taking remote WebRTC ice candidate from cache in ${type} connection with with ${publicKey}.`,
                );
                await getRtcPeerConnection().addIceCandidate(iceCandidate);
            }
            logger.debug(`[connection-saga] Set remote WebRTC description in ${type} connection with ${publicKey}.`);
        },
        async addIceCandidate(encryptedDataBase64: string): Promise<void> {
            logger.debug(
                `[connection-saga] Received remote WebRTC ice candidate in ${type} connection with ${publicKey}`,
            );
            const encryptedDataBytes = base64.decode(encryptedDataBase64);
            const remoteDataBytes = cryptography.decrypt(encryptedDataBytes, getSharedSymmetricKey());
            const remoteDataString = utf8.encode(remoteDataBytes);
            const remoteData = JSON.parse(remoteDataString);
            const remoteIceCandidate = remoteData as WebRtcIceCandidate;
            if (!remoteIceCandidate) {
                throw newError(
                    logger,
                    `[connection-saga] Wrong remote WebRTC ice candidate format in ${type} connection with ${publicKey}.`,
                );
            }
            if (getRtcPeerConnection().remoteDescription) {
                await getRtcPeerConnection().addIceCandidate(remoteIceCandidate);
            } else {
                logger.debug(
                    `[connection-saga] Cached remote WebRTC ice candidate in ${type} connection with ${publicKey}. Remote description is not ready yet.`,
                );
                iceCandidates.push(remoteIceCandidate);
            }
            logger.debug(
                `[connection-saga] Added remote WebRTC ice candidate in ${type} connection with ${publicKey}.`,
            );
        },
        send(message: Uint8Array): void {
            try {
                if (!(message instanceof Uint8Array)) throw new TypeError('Connection data must be a Uint8Array.');
                const dataEncrypted = cryptography.encrypt(message.slice(), getSharedSymmetricKey());
                getRtcSendDataChannel().send(dataEncrypted.slice());
            } catch (error) {
                logger.error(`[connection-saga] Error sending data in ${type} connection with ${publicKey}.`);
            }
        },
    };
    return saga;
}
