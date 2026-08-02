import { createMockLogger } from '../../__mocks__/test-utils';
import { CallData } from '../../src/models/infrasctructure/call-data';
import { CallMethodName } from '../../src/models/infrasctructure/call-method-name';
import { CallRequest } from '../../src/models/infrasctructure/call-request';
import { CallResponse } from '../../src/models/infrasctructure/call-response';
import { getApiClient } from '../../src/utils/api-client';
import { Logger } from '../../src/utils/logger';

const mockFetch = vi.fn();
global.fetch = mockFetch;

interface TestCallData extends CallData {
    b: string;
}

interface TestCallResponse extends CallResponse {
    data: string;
}

describe('ApiClient', () => {
    let apiClient: ReturnType<typeof getApiClient>;
    let mockLogger: Logger;

    beforeEach(() => {
        mockFetch.mockReset();

        mockLogger = createMockLogger();

        apiClient = getApiClient(mockLogger);
    });

    describe('call', () => {
        it('should make a POST request to the server with correct parameters', async () => {
            const serverUrl = 'https://api.example.com';
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'publicKey123',
                    b: 'test data',
                },
                c: 'signature123',
            };

            const mockResponse: TestCallResponse = {
                ok: true,
                timestamp: Date.now(),
                data: 'response data',
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValueOnce(mockResponse),
            });

            const result = await apiClient.call<TestCallData, TestCallResponse>(serverUrl, request);

            expect(mockFetch).toHaveBeenCalledWith(`${serverUrl}/api/v1/call`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(request),
            });

            expect(result).toEqual(mockResponse);
            expect(mockLogger.debug).toHaveBeenCalledWith(
                expect.stringContaining("Call 'testMethod' successfully sent"),
                request,
            );
        });

        it('should reject when response is not OK with proper error message', async () => {
            const serverUrl = 'https://api.example.com';
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'publicKey123',
                    b: 'test data',
                },
                c: 'signature123',
            };

            mockFetch.mockResolvedValueOnce({
                ok: false,
                status: 400,
                text: vi.fn().mockResolvedValueOnce('Bad Request'),
            });

            await expect(apiClient.call<TestCallData, TestCallResponse>(serverUrl, request)).rejects.toThrow(
                /Error while sending call 'testMethod'/,
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: '[api-client] Error while sending call \'testMethod\'. Status: 400; Body: "Bad Request".',
                    serverUrl: serverUrl,
                    reason: undefined,
                }),
            );
        });

        it('should reject when response has ok: false', async () => {
            const serverUrl = 'https://api.example.com';
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'publicKey123',
                    b: 'test data',
                },
                c: 'signature123',
            };

            const mockResponse: TestCallResponse = {
                ok: false,
                timestamp: Date.now(),
                reason: 'Validation failed',
                data: 'error data',
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValueOnce(mockResponse),
            });

            await expect(apiClient.call<TestCallData, TestCallResponse>(serverUrl, request)).rejects.toThrow(
                /Request was not successful/,
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining("Request was not successful on call 'testMethod'"),
                    serverUrl: serverUrl,
                    reason: mockResponse.reason,
                }),
            );
        });

        it('should reject when response is null or undefined', async () => {
            const serverUrl = 'https://api.example.com';
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'publicKey123',
                    b: 'test data',
                },
                c: 'signature123',
            };

            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValueOnce(null),
            });

            await expect(apiClient.call<TestCallData, TestCallResponse>(serverUrl, request)).rejects.toThrow(
                /Unexpected answer on call/,
            );

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.objectContaining({
                    message: expect.stringContaining('Unexpected answer on call testMethod'),
                    serverUrl: serverUrl,
                }),
            );
        });

        it('should reject when fetch throws an error', async () => {
            const serverUrl = 'https://api.example.com';
            const request: CallRequest<TestCallData> = {
                a: 'testMethod' as CallMethodName,
                b: {
                    a: 'publicKey123',
                    b: 'test data',
                },
                c: 'signature123',
            };

            const networkError = new Error('Network error');

            mockFetch.mockRejectedValueOnce(networkError);

            await expect(apiClient.call<TestCallData, TestCallResponse>(serverUrl, request)).rejects.toBe(networkError);

            expect(mockLogger.error).toHaveBeenCalledWith(
                expect.stringContaining('Error while sending request'),
                networkError,
                request,
            );
        });
    });
});
