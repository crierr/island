const cls = require('continuation-local-storage');

import * as restify from 'restify';
import * as Promise from 'bluebird';
import * as _ from 'lodash';
import * as os from 'os';
import * as amqp from 'amqplib';
import uuid = require('node-uuid');

import { AmqpChannelPoolService } from './amqp-channel-pool-service';
import paramSchemaInspector, { sanitize, validate } from '../middleware/schema.middleware';
import { RpcOptions } from '../controllers/rpc-decorator';
import { logger } from '../utils/logger';
import { VisualizeLog } from '../utils/visualize';
import reviver from '../utils/reviver';
import { AbstractError, AbstractLogicError, AbstractFatalError, ISLAND, LogicError, FatalError } from '../utils/error';

const RPC_EXEC_TIMEOUT_MS = parseInt(process.env.ISLAND_RPC_EXEC_TIMEOUT_MS, 10) || 25000;
const RPC_WAIT_TIMEOUT_MS = parseInt(process.env.ISLAND_RPC_WAIT_TIMEOUT_MS, 10) || 60000;

export interface IConsumerInfo {
  channel: amqp.Channel;
  tag: string;
  options?: RpcOptions;
}

interface Message {
  content: Buffer;
  properties: amqp.Options.Publish;
}

interface IRpcResponse {
  version: number;
  result: boolean;
  body?: AbstractError | any;
}

export interface RpcRequest {
  name: string;
  msg: any;
  options: RpcOptions;
}

class RpcResponse {
  static encode(body: any, serviceName: string): Buffer {
    let res: IRpcResponse = {
      version: 1,
      result: body instanceof Error ? false : true,
      body: body
    };

    return new Buffer(JSON.stringify(res, (k, v: AbstractError | number | boolean) => {
      if (v instanceof Error) {
        return {
          name: v.name,
          message: v.message,
          stack: v.stack,
          statusCode: v.statusCode,
          errorType: v.errorType,
          errorCode: v.errorCode,
          errorNumber: v.errorNumber,
          errorKey: v.errorKey,
          debugMsg: v.debugMsg,
          extra: v.extra,
          occurredIn: serviceName
        };
      }
      return v;
    }), 'utf8');
  }

  static decode(msg: Buffer): IRpcResponse {
    if (!msg) return;
    try {
      const res: IRpcResponse = JSON.parse(msg.toString('utf8'), reviver);
      if (!res.result) res.body = this.getAbstractError(res.body);

      return res;
    } catch (e) {
      logger.debug('[decode error]', e);
    }
  }

  static getAbstractError(err: AbstractError): AbstractError {
    let result: AbstractError;
    const enumObj = {};
    enumObj[err.errorNumber] = err.errorKey;
    switch (err.errorType) {
      case 'LOGIC':
        result = new AbstractLogicError(err.errorNumber, err.debugMsg, err.occurredIn, enumObj);
        break;
      case 'FATAL':
        result = new AbstractFatalError(err.errorNumber, err.debugMsg, err.occurredIn, enumObj);
        break;
      default:
        result = new AbstractError('ETC', 1, err.message, err.occurredIn, {1: 'F0001'});
        result.name = 'ETCError';
    }

    result.statusCode = err.statusCode;
    result.stack = err.stack;
    result.extra = err.extra;
    result.occurredIn = err.occurredIn;

    return result;
  }
}

function enterScope(properties: any, func): Promise<any> {
  return new Promise((resolve, reject) => {
    const ns = cls.getNamespace('app');
    ns.run(() => {
      _.each(properties, (value, key) => {
        ns.set(key, value);
      });
      Promise.try(func).then(resolve).catch(reject);
    });
  });
}

export default class RPCService {
  private consumerInfosMap: { [name: string]: IConsumerInfo } = {};
  private responseQueue: string;
  private responseConsumerInfo: IConsumerInfo;
  private reqExecutors: {[corrId: string]: (msg: Message) => Promise<any>} = {};
  private reqTimeouts: {[corrId: string]: any} = {};
  private channelPool: AmqpChannelPoolService;
  private serviceName: string;

  constructor(serviceName?: string) {
    this.serviceName = serviceName || 'unknown';
  }

  public async initialize(channelPool: AmqpChannelPoolService): Promise<any> {
    // NOTE: live docker 환경에서는 같은 hostname + process.pid 조합이 유일하지 않을 수 있다
    // docker 내부의 process id 는 1인 경우가 대부분이며 host=net으로 실행시키는 경우 hostname도 동일할 수 있다.
    this.responseQueue = `rpc.res.${this.serviceName}.${os.hostname()}.${uuid.v4()}`;
    logger.info(`consuming ${this.responseQueue}`);
    const consumer = (msg: Message) => {
      if (!msg) {
        logger.error(`[WARN] msg is null. consume was canceled unexpectedly`);
      }
      const reqExecutor = this.reqExecutors[msg.properties.correlationId];
      if (!reqExecutor) {
        // Request timeout이 생겨도 reqExecutor가 없음
        logger.notice('[RPC-WARNING] invalid correlationId');
        return;
      }
      delete this.reqExecutors[msg.properties.correlationId];
      return reqExecutor(msg);
    };

    this.channelPool = channelPool;
    await channelPool.usingChannel(channel => channel.assertQueue(this.responseQueue, {exclusive: true}));
    this.responseConsumerInfo = await this._consume(this.responseQueue, consumer, 'RequestExecutors', {});
  }

  protected async _consume(key: string, handler: (msg) => Promise<any>, tag: string, options?: any):
      Promise<IConsumerInfo> {
    const channel = await this.channelPool.acquireChannel();
    const result = await channel.consume(key, async (msg) => {
      try {
        await handler(msg);
        channel.ack(msg);
      } catch (error) {
        if (error.statusCode && parseInt(error.statusCode, 10) === 503) {
          // Requeue the message when it has a chance
          setTimeout(() => {
            channel.nack(msg);
          }, 1000);
          return;
        }
        // Discard the message
        channel.ack(msg);

        this.channelPool.usingChannel(channel => {
          const content = RpcResponse.encode(error, this.serviceName);
          const headers = msg.properties.headers;
          const correlationId = msg.properties.correlationId;
          const properties: amqp.Options.Publish = { correlationId, headers };
          return Promise.resolve(channel.sendToQueue(msg.properties.replyTo, content, properties));
        });
      }
    }, options || {});

    return {channel: channel, tag: result.consumerTag};
  }

  public _publish(exchange: any, routingKey: any, content: any, options?: any) {
    return this.channelPool.usingChannel(channel => {
      return Promise.resolve(channel.publish(exchange, routingKey, content, options));
    });
  }

  public purge() {
    //todo: cancel consume
    return Promise.resolve();
  }

  // [TODO] register의 consumer와 _consume의 anonymous function을 하나로 합쳐야 한다.
  // 무척 헷갈림 @kson //2016-08-09
  // [TODO] Endpoint도 동일하게 RpcService.register를 부르는데, rpcOptions는 Endpoint가 아닌 RPC만 전달한다
  // 포함 관계가 잘못됐다. 애매하다. @kson //2016-08-09
  public async register(name: string, handler: (req: any) => Promise<any>, rpcOptions?: RpcOptions): Promise<void> {
    const consumer = (msg: Message) => {
      const headers = msg.properties.headers;
      const tattoo = headers && headers.tattoo;
      const log = new VisualizeLog(tattoo, msg.properties.timestamp);
      log.size = msg.content.byteLength;
      log.from = headers.from;
      log.to = { node: process.env.HOSTNAME, context: name, island: this.serviceName, type: 'rpc' };
      return enterScope({RequestTrackId: tattoo, Context: name, Type: 'rpc'}, () => {
        let content = JSON.parse(msg.content.toString('utf8'), reviver);
        if (rpcOptions) {
          if (_.get(rpcOptions, 'schema.query.sanitization')) {
            content = sanitize(rpcOptions.schema.query.sanitization, content);
          }
          if (_.get(rpcOptions, 'schema.query.validation')) {
            if (!validate(rpcOptions.schema.query.validation, content)) {
              throw new LogicError(ISLAND.LOGIC.L0002_WRONG_PARAMETER_SCHEMA, `Wrong parameter schema`);
            }
          }
        }

        logger.debug(`Got ${name} with ${JSON.stringify(content)}`)

        // Should wrap with Promise.try while handler sometimes returns ES6 Promise which doesn't support timeout.
        const options: amqp.Options.Publish = { correlationId: msg.properties.correlationId, headers };
        return Promise.try(() => handler(content))
          .then(res => {
            log.end();
            if (rpcOptions) {
              if (_.get(rpcOptions, 'schema.result.sanitization')) {
                res = sanitize(rpcOptions.schema.result.sanitization, res);
              }
              if (_.get(rpcOptions, 'schema.result.validation')) {
                validate(rpcOptions.schema.result.validation, res);
              }
            }
            this.channelPool.usingChannel(channel => {
              return Promise.resolve(channel.sendToQueue(msg.properties.replyTo, RpcResponse.encode(res, this.serviceName), options));
            });
          })
          .timeout(RPC_EXEC_TIMEOUT_MS)
          .catch(err => {
            log.end(err);
            // 503 오류일 때는 응답을 caller에게 안보내줘야함
            if (err.statusCode && parseInt(err.statusCode, 10) === 503) {
              throw err;
            }
            if (!err.extra) {
              err.extra = { island: this.serviceName, name, req: content };
            }
            const extra = err.extra;
            logger.error(`Got an error during ${extra.island}/${extra.name} with ${JSON.stringify(extra.req)} - ${err.stack}`);
            return this.channelPool.usingChannel(channel => {
              return Promise.resolve(channel.sendToQueue(msg.properties.replyTo, RpcResponse.encode(err, this.serviceName), options));
            }).then(() => {
              throw err;
            })
          })
          .finally(() => {
            log.shoot();
          });
      });
    };

    // NOTE: 컨슈머가 0개 이상에서 0개가 될 때 자동으로 삭제된다.
    // 단 한번도 컨슈머가 등록되지 않는다면 영원히 삭제되지 않는데 그런 케이스는 없음
    await this.channelPool.usingChannel(channel => channel.assertQueue(name, {durable: false, autoDelete: true}));
    this.consumerInfosMap[name] = await this._consume(name, consumer, 'SomeoneCallsMe');
  }

  public unregister(name: string) {
    const consumerInfo = this.consumerInfosMap[name];
    if (!consumerInfo) return Promise.resolve();
    return this._cancel(consumerInfo)
      .then(ok => {
        delete this.consumerInfosMap[name];
        return ok;
      });
  }

  protected async _cancel(consumerInfo: IConsumerInfo): Promise<void> {
    await consumerInfo.channel.cancel(consumerInfo.tag);
    await this.channelPool.releaseChannel(consumerInfo.channel);
  }

  private rpcMessageExpander(name: string, msg: any): RpcRequest {
    return { name: name, msg: msg, options: this.consumerInfosMap[name] ? this.consumerInfosMap[name].options : {} };
  }

  public async invoke<T, U>(name: string, msg: T, opts?: any): Promise<U>;
  public async invoke(name: string, msg: any, opts?: any): Promise<any>;
  public async invoke(name: string, msg: any, opts?: any): Promise<any> {
    const ns = cls.getNamespace('app');
    const tattoo = ns.get('RequestTrackId');
    const context = ns.get('Context');
    const type = ns.get('Type');
    const correlationId = uuid.v4();
    const headers = {
      tattoo,
      from: { node: process.env.HOSTNAME, context, island: this.serviceName, type }
    };
    const content = new Buffer(JSON.stringify(msg), 'utf8');
    const options: amqp.Options.Publish = {
      headers,
      correlationId,
      timestamp: +(new Date()),
      replyTo: this.responseQueue,
      expiration: `${RPC_WAIT_TIMEOUT_MS}` // [FIXME] https://github.com/louy/typed-amqplib/pull/1
    };
    await this.channelPool.usingChannel(channel => {
      return Promise.resolve(channel.sendToQueue(name, content, options));
    });
    return await this.markTattoo(name, correlationId, tattoo, ns, opts);
  }

  private markTattoo(name: string, corrId: any, tattoo: any, ns: any, opts: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // 지저분한데 bluebird .timeout으로 교체할 방법 없을까?
      // @kson //2016-08-11
      this.reqTimeouts[corrId] = setTimeout(() => {
        // Cleanup registered response executors
        delete this.reqTimeouts[corrId];
        delete this.reqExecutors[corrId];

        const err = new FatalError(
          ISLAND.FATAL.F0023_RPC_TIMEOUT,
          `RPC(${name} does not return in ${RPC_WAIT_TIMEOUT_MS} ms`
        );
        err.statusCode = 504;
        return reject(err);
      }, RPC_WAIT_TIMEOUT_MS);

      this.reqExecutors[corrId] = ns.bind((msg: Message) => {
        clearTimeout(this.reqTimeouts[corrId]);
        delete this.reqTimeouts[corrId];

        const res = RpcResponse.decode(msg.content);
        if (!res.result) return reject(res.body);
        if (opts && opts.withRawdata) {
          return resolve({body: res.body, raw: msg.content});
        }
        return resolve(res.body);
      });
    });
  }
}
