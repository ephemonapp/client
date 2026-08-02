import { CallData } from '../models/infrasctructure/call-data';
import { CallPayload } from '../models/infrasctructure/call-payload';
import { Logger } from '../utils/logger';
import { AnswerCallHandler } from './handle/answer-call-handler';
import { CallHandler } from './handle/call-handler';
import { CloseCallHandler } from './handle/close-call-handler';
import { DialCallHandler, DialCallHandlerConfig } from './handle/dial-call-handler';
import { IceCallHandler } from './handle/ice-call-handler';
import { OfferCallHandler } from './handle/offer-call-handler';
import { TimeService } from './time-service';

export type HandleServiceConfig = {} & DialCallHandlerConfig;

export interface HandleService {
    initialize(config: HandleServiceConfig): void;

    call(payload: CallPayload, timeService: TimeService): Promise<void>;
}

export function getHandleService(
    logger: Logger,
    dialCallHandler: DialCallHandler,
    offerCallHandler: OfferCallHandler,
    answerCallHandler: AnswerCallHandler,
    iceCallHandler: IceCallHandler,
    closeCallHandler: CloseCallHandler,
): HandleService {
    async function processCallInternal<TypeData extends CallData>(
        handler: CallHandler<TypeData>,
        payload: CallPayload,
        timeService: TimeService,
        validate: boolean,
    ): Promise<boolean> {
        const request = handler.parse(payload);
        if (validate) {
            const isValid = handler.validate(request, timeService);
            if (!isValid) {
                logger.debug(`[handle-service] Call '${request.a}' is not valid, skipped.`);
                return true;
            }
        }
        logger.debug(`[handle-service] Processing incoming call '${request.a}' from ${request.b.a}...`);
        if (!(await handler.handle(request))) {
            logger.debug(`[handle-service] Postpone processing call '${payload.a}'.`, payload);
            queue.push({ payload: payload, timeService: timeService });
            return false;
        }
        logger.debug(`[handle-service] Successfully processed call '${payload.a}'`, payload);
        return true;
    }

    async function processCall(
        payload: CallPayload,
        timeService: TimeService,
        validate: boolean = true,
    ): Promise<boolean> {
        switch (payload.a) {
            case 'dial':
                return await processCallInternal(dialCallHandler, payload, timeService, validate);
            case 'offer':
                return await processCallInternal(offerCallHandler, payload, timeService, validate);
            case 'answer':
                return await processCallInternal(answerCallHandler, payload, timeService, validate);
            case 'ice':
                return await processCallInternal(iceCallHandler, payload, timeService, validate);
            case 'close':
                return await processCallInternal(closeCallHandler, payload, timeService, validate);
        }
        return true;
    }

    let queue: Array<{ payload: CallPayload; timeService: TimeService }> = [];

    async function processCallQueue() {
        for (let queued = queue.shift(); queued !== undefined; queued = queue.shift()) {
            if (!(await processCall(queued.payload, queued.timeService, false))) {
                break;
            }
        }
        setTimeout(processCallQueue, 500);
    }

    processCallQueue().catch(logger.error);
    return {
        initialize(config: HandleServiceConfig): void {
            dialCallHandler.initialize(config);
            logger.debug('[handle-service] Initialized.');
        },
        async call(payload: CallPayload, timeService: TimeService): Promise<void> {
            await processCall(payload, timeService);
        },
    };
}
