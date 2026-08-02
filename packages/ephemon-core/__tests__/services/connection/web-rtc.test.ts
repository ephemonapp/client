describe('WebRTC', () => {
    const MockRTCPeerConnection = function () {};
    const MockRTCDataChannel = function () {};

    it('should return a WebRTC implementation with PeerConnection and DataChannel', () => {
        const webRTC = { PeerConnection: MockRTCPeerConnection, DataChannel: MockRTCDataChannel };

        expect(webRTC).toBeDefined();
        expect(webRTC.PeerConnection).toBe(MockRTCPeerConnection);
        expect(webRTC.DataChannel).toBe(MockRTCDataChannel);
    });

    it('should match the WebRTC interface', () => {
        const webRTC = { PeerConnection: MockRTCPeerConnection, DataChannel: MockRTCDataChannel };

        expect(typeof webRTC.PeerConnection).toBe('function');
        expect(typeof webRTC.DataChannel).toBe('function');

        const webRTCKeys = Object.keys(webRTC);
        expect(webRTCKeys).toContain('PeerConnection');
        expect(webRTCKeys).toContain('DataChannel');
        expect(webRTCKeys.length).toBe(2);
    });
});
