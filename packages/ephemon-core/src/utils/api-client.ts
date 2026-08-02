import { CallData } from '../models/infrasctructure/call-data';
import { CallRequest } from '../models/infrasctructure/call-request';
import { CallResponse } from '../models/infrasctructure/call-response';
import { newCallError } from './call-error';
import { Logger } from './logger';

export interface ApiClient {
    call<TypeData extends CallData, TypeResponse extends CallResponse>(
        serverUrl: string,
        request: CallRequest<TypeData>,
    ): Promise<TypeResponse>;
}

export function getApiClient(logger: Logger): ApiClient {
    return {
        call<TypeData extends CallData, TypeResponse extends CallResponse>(
            serverUrl: string,
            request: CallRequest<TypeData>,
        ): Promise<TypeResponse> {
            return new Promise<TypeResponse>((resolve, reject) => {
                const method = request.a;
                fetch(`${serverUrl}/api/v1/call`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request),
                })
                    .then((response) => {
                        if (response.ok) {
                            response.json().then((result) => {
                                const typedResponse = result as TypeResponse;
                                if (!typedResponse) {
                                    reject(
                                        newCallError(
                                            logger,
                                            `[api-client] Unexpected answer on call ${method} from ${serverUrl}.`,
                                            serverUrl,
                                        ),
                                    );
                                    return;
                                }
                                if (!typedResponse.ok) {
                                    reject(
                                        newCallError(
                                            logger,
                                            `[api-client] Request was not successful on call '${method}'. Reason: ${typedResponse.reason}; Response: ${JSON.stringify(typedResponse)}.`,
                                            serverUrl,
                                            typedResponse.reason,
                                        ),
                                    );
                                    return;
                                }
                                logger.debug(
                                    `[api-client] Call '${method}' successfully sent. Response: ${JSON.stringify(typedResponse)}`,
                                    request,
                                );
                                resolve(result);
                            });
                        } else {
                            response.text().then((body) => {
                                reject(
                                    newCallError(
                                        logger,
                                        `[api-client] Error while sending call '${method}'. Status: ${response.status}; Body: ${JSON.stringify(body)}.`,
                                        serverUrl,
                                    ),
                                );
                            });
                        }
                    })
                    .catch((err) => {
                        logger.error(`[api-client] Error while sending request.`, err, request);
                        reject(err);
                    });
            });
        },
    };
}
