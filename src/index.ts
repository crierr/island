require('source-map-support').install();

const cls = require('continuation-local-storage');
const ns = cls.getNamespace('app') || cls.createNamespace('app');
require('cls-mongoose')(ns);
require('cls-bluebird')(ns);

export import mongoose = require('mongoose');
mongoose.Promise = Promise as any;

import Islet from './islet';
export { Islet };

// adapters
export { default as AbstractAdapter } from './adapters/abstract-adapter';
export { default as ListenableAdapter } from './adapters/listenable-adapter';

// adapters/impl
export { default as MessageBrokerAdapter } from './adapters/impl/message-broker-adapter';
export { default as MongooseAdapter } from './adapters/impl/mongoose-adapter';
export { default as PushAdapter } from './adapters/impl/push-adapter';
export { default as RedisConnectionAdapter } from './adapters/impl/redis-connection-adapter';
export { default as RestifyAdapter } from './adapters/impl/restify-adapter';
export { default as RPCAdapter } from './adapters/impl/rpc-adapter';
export { default as SocketIOAdapter } from './adapters/impl/socketio-adapter';
export {
  default as RabbitMqAdapter,
  RabbitMqAdapterOptions
} from './adapters/impl/rabbitmq-adapter';
export { AmqpChannelPoolAdapter } from './adapters/impl/amqp-channel-pool-adapter';
export { EventAdapter, EventAdapterOptions } from './adapters/impl/event-adapter';

// controllers
export { default as AbstractController } from './controllers/abstract-controller';
export {
  validate,
  sanitize,
  admin,
  auth,
  devonly,
  EndpointOptions,
  EndpointSchemaOptions,
  endpoint,
  endpointController,
} from './controllers/endpoint-decorator';
export {
  rpc,
  rpcController
} from './controllers/rpc-decorator';
export {
  Response,
  middleware
} from './controllers/middleware-decorator';
export { eventController, subscribeEvent, subscribePattern } from './controllers/event-decorator';


// models
/**
 * @deprecated
 */
export { default as ModelFactory } from './models/model-factory';

// services
export { default as MessageBrokerService } from './services/message-broker-service';
export { default as PushService } from './services/push-service';
export { default as RPCService } from './services/rpc-service';

export {
  default as AbstractBrokerService,
  IConsumerInfo
} from './services/abstract-broker-service';
export { AmqpChannelPoolService, AmqpOptions } from './services/amqp-channel-pool-service';
export { EventService } from './services/event-service';
export { Event, BaseEvent } from './services/event-subscriber';

// utils
export * from './utils/di';
export { Loggers } from './utils/loggers';
export { VisualizeLog } from './utils/visualize';
export { ScopeExit } from './utils/scope-exit';
export { ResourcePush } from './utils/resource-push';
export { default as MessagePack } from './utils/msgpack';
export { default as ObjectWrapper } from './utils/object-wrapper';
export { default as ObjectFactory } from './utils/object-factory';
export { default as StaticDataLoader } from './utils/staticdata-loader';
export { default as StaticDataFactory } from './utils/staticdata-factory';
export { jasmineAsyncAdapter as spec, createSpyObjWithAllMethods as spyAll } from './utils/jasmine-async-support';
export { ErrorType, AbstractError, AbstractFatalError, AbstractLogicError } from './utils/error';
export { Events } from './utils/event';
