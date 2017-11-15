import * as _ from 'lodash';
import { ISLAND, LogicError } from '../utils/error';
import { logger } from '../utils/logger';
import MessagePack from '../utils/msgpack';
import { AmqpChannelPoolService } from './amqp-channel-pool-service';

const SERIALIZE_FORMAT_PUSH = process.env.SERIALIZE_FORMAT_PUSH;
export type BroadcastTarget = 'all' | 'pc' | 'mobile';
export const BroadcastTargets = ['all', 'pc', 'mobile'];

export default class PushService {
  // Exchange to broadcast to the entire users.
  public static broadcastExchange = {
    name: {
      all: 'PUSH_FANOUT_EXCHANGE',
      pc: 'PUSH_PC_FANOUT_EXCHANGE',
      mobile: 'PUSH_MOBILE_FANOUT_EXCHANGE'
    },
    options: {
      durable: true
    },
    type: 'fanout'
  };

  // Exchange to push to a specific user.
  public static playerPushExchange = {
    name: 'push.player',
    options: {
      durable: true
    },
    type: 'direct'
  };
  public static msgpack = MessagePack.getInst();

  public static encode(obj): Buffer {
    try {
      let buf;
      switch (SERIALIZE_FORMAT_PUSH) {
        case 'json':
          buf = new Buffer(JSON.stringify(obj));
          break;
        default:
          buf = PushService.msgpack.encode(obj);
          break;
      }
      return buf;
    } catch (e) {
      e.formatType = SERIALIZE_FORMAT_PUSH;
      logger.debug('[JSON ENCODE ERROR]', e);
      const error = new LogicError(ISLAND.LOGIC.L0007_PUSH_ENCODE_ERROR, e.message);
      logger.debug(error.stack);
      throw e;
    }
  }

  public static decode(buf) {
    let obj;
    switch (SERIALIZE_FORMAT_PUSH) {
      case 'json':
        obj = JSON.parse(buf.toString());
        break;
      default:
        obj = PushService.msgpack.decode(buf);
        break;
    }
    return obj;
  }

  public static hashExchangeName(name: string, n: number): number {
    return name.split('').reduce((sum, curChar) => sum + curChar.charCodeAt(0), 0) % n;
  }

  private static DEFAULT_EXCHANGE_OPTIONS: any = {
    autoDelete: true,
    durable: true
  };

  private static autoDeleteTriggerQueue = {
    name: 'auto-delete.trigger',
    options: {
      messageTtl: 0
    }
  };

  private channelPools: AmqpChannelPoolService[];
  private manualSpread: boolean = false;

  constructor() {
  }

  get brokerIndices(): number[] {
    return _.range(this.channelPools.length);
  }

  async initialize(channelPools: AmqpChannelPoolService[]): Promise<any> {
    this.channelPools = channelPools;
    await Promise.all(_.map(channelPools, cpool => this.initBroker(cpool)));
    const MANUAL_SPREAD = process.env.MANUAL_SPREAD;
    if (MANUAL_SPREAD === '1' || MANUAL_SPREAD === 'true') {
      this.manualSpread = true;
      logger.info(`This node operates in MANUAL_SPREAD mode. Do not use RabbitMQ federation.`);
    }
  }

  async purge(): Promise<any> {
    await Promise.all(_.map(this.channelPools, cpool => cpool.purge()));
  }

  async deleteExchange(exchange: string,
                       options?: any,
                       brokerOptions: BrokerOptions = { hashKey: exchange }): Promise<any> {
    const { channelPool } = this.selectChannelPool(brokerOptions);
    return channelPool.usingChannel(channel => {
      logger.debug(`[INFO] delete exchange's name ${exchange}`);
      return channel.deleteExchange(exchange, options);
    });
  }

  /**
   * bind specific exchange wrapper
   * @param destination
   * @param source
   * @param pattern
   * @param sourceType
   * @param sourceOpts
   * @returns {Promise<any>}
   */
  // FIXME: too many arguments.
  async bindExchange(destination: string,
                     source: string,
                     pattern: string = '',
                     sourceType: string = 'fanout',
                     sourceOpts: any = PushService.DEFAULT_EXCHANGE_OPTIONS,
                     brokerOptions: BrokerOptions = { hashKey: destination }
  ): Promise<any> {
    const { channelPool, brokerIndex } = this.selectChannelPool(brokerOptions);
    logger.debug(`bind exchange. ${source} ==${pattern}==> ${destination} in broker#${brokerIndex}`);
    let sourceDeclared = false;
    try {
      await channelPool.usingChannel(async channel => {
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
        await channelPool.usingChannel(async channel => {
          await channel.bindQueue(PushService.autoDeleteTriggerQueue.name, source, '');
          await channel.unbindQueue(PushService.autoDeleteTriggerQueue.name, source, '');
        });
      }
      throw e;
    }
  }

  /**
   * unbind exchange wrapper
   * @param destination
   * @param source
   * @param pattern
   * @returns {Promise<any>}
   */
  // FIXME: too many arguments.
  async unbindExchange(destination: string,
                       source: string,
                       pattern: string = '',
                       brokerOptions: BrokerOptions = { hashKey: destination }
  ): Promise<any> {
    const { channelPool, brokerIndex } = this.selectChannelPool(brokerOptions);
    logger.debug(`unbind exchange; ${source} --${pattern}--X ${destination} in broker#${brokerIndex}`);
    return channelPool.usingChannel(channel => {
      return channel.unbindExchange(destination, source, pattern, {});
    });
  }

  /**
   * publish message to a player
   * @param pid
   * @param msg
   * @param options
   * @returns {Promise<any>}
   */
  async unicast(pid: string, msg: any, options?: any): Promise<any> {
    // Surely, we already know what broker should take the message.
    const { channelPool } = this.selectChannelPool({ hashKey: pid });
    return channelPool.usingChannel(async channel => {
      return channel.publish(PushService.playerPushExchange.name, pid, PushService.encode(msg), options);
    });
  }

  /**
   * publish message to specific exchange
   * @param exchange
   * @param msg
   * @param routingKey
   * @param options
   * @returns {Promise<any>}
   */
  async multicast(exchange: string, msg: any, routingKey: string = '', options?: any): Promise<void> {
    if (this.manualSpread) {
      await Promise.all(_.map(this.channelPools, channelPool => this.multicastOne({
        channelPool, exchange, msg, routingKey, options
      })));
    } else {
      const channelPool = _.sample(this.channelPools);
      await this.multicastOne({ channelPool, exchange, msg, routingKey, options });
    }
  }

  /**
   * publish message to global fanout exchange
   * @param msg message to broadcast. message should be MessagePack encodable.
   * @param options publish options
   * @returns {Promise<any>}
   */
  async broadcast(msg: any, options?: any): Promise<any> {
    if (this.manualSpread) {
      await Promise.all(_.map(this.channelPools, channelPool => this.broadcastOne({
        channelPool, msg, options
      })));
    } else {
      const channelPool = _.sample(this.channelPools);
      await this.broadcastOne({ channelPool, msg, options });
    }
  }

  private async initBroker(channelPool: AmqpChannelPoolService): Promise<void> {
    await channelPool.usingChannel(async channel => {
      const playerPushX = PushService.playerPushExchange;
      const broadcastExchange = PushService.broadcastExchange;
      await Promise.all(_.map(broadcastExchange.name, async name => {
        await channel.assertExchange(name,
          broadcastExchange.type, PushService.broadcastExchange.options);
      }));
      await channel.assertExchange(playerPushX.name, playerPushX.type, playerPushX.options);
      await channel.assertQueue(PushService.autoDeleteTriggerQueue.name, PushService.autoDeleteTriggerQueue.options);
      await channel.bindExchange(PushService.broadcastExchange.name.pc, PushService.broadcastExchange.name.all, '');
      await channel.bindExchange(PushService.broadcastExchange.name.mobile, PushService.broadcastExchange.name.all, '');
    });
  }

  private selectChannelPool({ hashKey, brokerIndex }: BrokerOptions): {
    channelPool: AmqpChannelPoolService,
    brokerIndex: number
  } {
    if (_.isNumber(brokerIndex)) {
      brokerIndex %= this.channelPools.length;
    } else {
      brokerIndex = PushService.hashExchangeName(hashKey || '', this.channelPools.length);
    }
    return {
      channelPool: this.channelPools[brokerIndex],
      brokerIndex
    };
  }

  private async multicastOne({ channelPool, exchange, msg, routingKey, options }: {
    channelPool: AmqpChannelPoolService;
    exchange: string;
    msg: any;
    routingKey: string;
    options?: any;
  }): Promise<any> {
    return channelPool.usingChannel(async channel => {
      return channel.publish(exchange, routingKey, PushService.encode(msg), options);
    });
  }

  private async broadcastOne({ channelPool, msg, options }: {
    channelPool: AmqpChannelPoolService;
    msg: any;
    options?: any;
  }): Promise<any> {
    return channelPool.usingChannel(async channel => {
      const target: BroadcastTarget = options && options.broadcastTarget || 'all';
      const fanout = PushService.broadcastExchange.name[target];
      return channel.publish(fanout, '', PushService.encode(msg), options);
    });
  }
}

export interface BrokerOptions {
  hashKey?: string;
  brokerIndex?: number;
}
