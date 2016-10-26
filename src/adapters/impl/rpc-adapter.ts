import * as Promise from 'bluebird';
import RabbitMqAdapter from './rabbitmq-adapter';
import RPCService, { RpcHookType, RpcHook } from '../../services/rpc-service';
import ListenableAdapter from '../listenable-adapter';
import { AmqpChannelPoolAdapter } from './amqp-channel-pool-adapter';
import { LogicError, FatalError, ISLAND } from '../../utils/error';

export interface RPCAdapterOptions {
  amqpChannelPoolAdapter: AmqpChannelPoolAdapter;
  serviceName: string;
}

export default class RPCAdapter extends ListenableAdapter<RPCService, RPCAdapterOptions> {
  hooks: {type: RpcHookType, hook: RpcHook}[];
  constructor(options) {
    super(options);
    this.hooks = [];
  }
  async initialize(): Promise<void> {
    this._adaptee = new RPCService(this.options.serviceName || 'unknownService');
    let amqpChannelPoolService = this.options.amqpChannelPoolAdapter.adaptee;
    if (!amqpChannelPoolService) throw new FatalError(ISLAND.FATAL.F0010_AMQP_CHANNEL_POOL_REQUIRED, 'AmqpChannelPoolService required');
    await amqpChannelPoolService.waitForInit();
    this.hooks.forEach(hook => {
      this._adaptee.registerHook(hook.type, hook.hook);
    });
    return this._adaptee.initialize(amqpChannelPoolService);
  }

  listen(): Promise<void> {
    return Promise.resolve();
  }

  async destroy(): Promise<any> {
    await super.destroy();
    return this.adaptee.purge();
  }
  
  registerHook(type: RpcHookType, hook: RpcHook) {
    this.hooks.push({type, hook});
  }
}
