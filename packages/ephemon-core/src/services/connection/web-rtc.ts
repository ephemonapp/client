export interface WebRTC {
    PeerConnection: typeof RTCPeerConnection;

    DataChannel: typeof RTCDataChannel;
}

export function getDefaultWebRTC(): WebRTC {
    return {
        PeerConnection: RTCPeerConnection,
        DataChannel: RTCDataChannel,
    };
}
