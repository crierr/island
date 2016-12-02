'use strict';

import * as amqp from 'amqplib';
import * as Promise from 'bluebird';
import MessagePack from '../utils/msgpack';
import { AmqpChannelPoolService } from './amqp-channel-pool-service';
import _debug = require('debug');
import * as _ from 'lodash';

let debug = _debug('ISLAND:SERVICES:PUSH');

export default class PushService {
  private static DEFAULT_EXCHANGE_OPTIONS: any = {
    durable: true,
    autoDelete: true
  };

  private msgpack: MessagePack;
  private channelPool: AmqpChannelPoolService;

  // this exchange is used for braodcasting
  public static globalFanoutExchange = {
    name: 'PUSH_FANOUT_EXCHANGE',
    option: {
      durable: true
    }
  };

  public static autoDeleteTriggerQueue = {
    name: 'auto-delete.trigger',
    options: {
      messageTtl: 0
    }
  };

  constructor() {
    this.msgpack = MessagePack.getInst();
  }

  public async initialize(channelPool: AmqpChannelPoolService): Promise<any> {
    this.channelPool = channelPool;

    await this.channelPool.usingChannel(async (channel) => {
      await channel.assertExchange(PushService.globalFanoutExchange.name, 'fanout',
        PushService.globalFanoutExchange.option);
      await channel.assertQueue(PushService.autoDeleteTriggerQueue.name, PushService.autoDeleteTriggerQueue.options);
    });
  }

  purge() {
    return this.channelPool.usingChannel(channel => {
      return channel.deleteExchange(PushService.globalFanoutExchange.name, {ifUnused: true});
    });
  }

  deleteExchange(exchange:string, options?: any) {
    return this.channelPool.usingChannel(channel => {
      return this._deleteExchange(channel, [exchange], options);
    });
  }

  private _deleteExchange(channel: amqp.Channel, exchanges: string[], options) {
    return Promise.reduce(exchanges, (total, exchange) => {
      debug(`[INFO] delete exchange's name ${exchange}`)
      return Promise.resolve(channel.deleteExchange(exchange, options));
    }, 0);
  }

  /**
   * bind specific exchange to (Account|Player) exchange
   * @param destination
   * @param source
   * @param pattern
   * @param sourceType
   * @param sourceOpts
   * @returns {Promise<any>}
   */
  async bindExchange(destination: string,
                     source: string,
                     pattern: string = '',
                     sourceType: string = 'fanout',
                     sourceOpts: any = PushService.DEFAULT_EXCHANGE_OPTIONS
  ): Promise<any> {
    debug(`bind exchanges. (source:${source}) => destination:${destination}`);

    let sourceDeclared = false;
    try {
      await this.channelPool.usingChannel(async (channel) => {
        await channel.assertExchange(source, sourceType, sourceOpts);
        sourceDeclared = true;
        await channel.bindExchange(destination, source, pattern);
      });
    } catch (e) {
      // Auto-delete is triggered only when target exchange(or queue) is unbound or deleted.
      // If previous bind fails, we can't ensure auto-delete triggered or not.
      // Below workaround prevents this from happening.
      // caution: Binding x-recent-history exchange to unroutable target causes connection loss.
      // target should be a queue and routable.
      if (sourceDeclared && sourceOpts.autoDelete) {
        await this.channelPool.usingChannel(async (channel) => {
          await channel.bindQueue(PushService.autoDeleteTriggerQueue.name, source, '');
          await channel.unbindQueue(PushService.autoDeleteTriggerQueue.name, source, '');
        });
      }
      throw e;
    }
  }

  /**
   * unbind specfic exchange from (Account|Player) exchange
   * @param destination
   * @param source
   * @param pattern
   * @returns {Promise<any>}
   */
  unbindExchange(destination: string, source: string, pattern?: string) {
    return this.channelPool.usingChannel(channel => {
      return channel.unbindExchange(destination, source, pattern || '', {});
    });
  }

  /**
   * publish message to (Account|Player) exchange
   * @param exchange
   * @param msg
   * @param options
   * @returns {Promise<any>}
   */
  unicast(exchange: string, msg: any, options?: any) {
    return this.channelPool.usingChannel(channel => {
      return Promise.resolve(channel.publish(exchange, '', this.msgpack.encode(msg), options));
    });
  }

  /**
   * publish message to specific exchange bound to (Account|Player) exchange
   * @param exchange
   * @param msg
   * @param routingKey
   * @param options
   * @returns {Promise<any>}
   */
  multicast(exchange: string, msg: any, routingKey?: string, options?: any) {
    return this.channelPool.usingChannel(channel => {
      return Promise.resolve(channel.publish(exchange, routingKey || '', this.msgpack.encode(msg), options));
    });
  }

  /**
   * publish message to global fanout exchange
   * @param msg message to broadcast. message should be MessagePack encodable.
   * @param options publish options
   * @returns {Promise<any>}
   */
  broadcast(msg: any, options?: any) {
    return this.channelPool.usingChannel(channel => {
      const fanout = PushService.globalFanoutExchange.name;
      return Promise.resolve(channel.publish(fanout, '', this.msgpack.encode(msg), options));
    });
  }
}
